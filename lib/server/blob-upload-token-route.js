// Shared implementation behind every Vercel Blob client-upload token
// endpoint: PUBLIC /api/uploads/blob (room-photo guests), SESSION_ONLY
// /api/owner/events/:slug/private-delivery/blob (owner-issued private
// delivery), and PUBLIC /api/photographer-upload/:token/blob (photographer
// link). All three ultimately hand the same @vercel/blob client-upload
// handshake to the same onBeforeGenerateToken/onUploadCompleted callbacks,
// which resolve the actual upload kind from the signed session id in the
// request body — so there is exactly one implementation, not three.
//
// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `issueBlobUploadToken`, aliased by `issuePrivateDeliveryBlobToken` and
// `issuePhotographerBlobToken`). Behavior, status codes, and rate limiting
// are unchanged.
import { BlobError } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
import { BlobUploadKind } from '@prisma/client'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkRateLimit, rateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { isVercelBlobStorageConfigured } from '@/lib/server/storage'
import {
  BlobUploadTokenRequestError,
  createLazyServerBoundBlobUploadCallbacks,
  getBlobUploadRequestKind,
  parseCanonicalSessionPayload,
  validateBlobUploadCallbackUrl,
} from '@/lib/server/blob-upload-token'
import { json, isDatabaseUnavailableError } from '@/lib/server/api-response'

export async function handleBlobUploadTokenRequest(request) {
  // 1. Parse body once — needed for classification and handleUpload
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  // 2. Strict classification — unknown types return 400 without Prisma access
  let requestKind
  try {
    requestKind = getBlobUploadRequestKind(body)
  } catch (error) {
    if (error instanceof BlobUploadTokenRequestError) {
      return json({ error: error.publicMessage, code: error.code }, error.status)
    }
    return json({ error: 'Invalid request body' }, 400)
  }
  const callbackRequest = requestKind === 'callback'

  // 3. For token-generation requests: rate limiting and callbackUrl
  //    validation, before BLOB_READ_WRITE_TOKEN check and handleUpload.
  //    Rate limiting is now two-stage:
  //      a. A broad, Redis-backed, hashed-IP guard runs first and is the
  //         ONLY thing that runs before any database access — it exists
  //         purely to bound pre-lookup DB exposure from a single IP
  //         sending syntactically-valid-but-arbitrary session ids, and is
  //         deliberately far above any single flow's own policy.
  //      b. Once past (a), a read-only BlobUploadSession lookup resolves
  //         uploadKind/eventId (never mutates — the real claim happens
  //         later, inside onBeforeGenerateToken, unchanged). Photographer
  //         and private-delivery sessions each get their own eventId-scoped
  //         bucket; room-photo and unresolved/malformed sessions fall
  //         through to the existing shared legacy IP limiter, unchanged.
  if (!callbackRequest) {
    const clientIp = getClientIp(request)

    const broadGuard = await checkRateLimit(
      `blob-token-broad:ip:${hashIdentifier(clientIp)}`,
      RATE_LIMITS.uploadBlobBroad.ip.max,
      RATE_LIMITS.uploadBlobBroad.ip.window,
    )
    if (broadGuard.limited) {
      return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
    }

    let sessionId = null
    try {
      ;({ sessionId } = parseCanonicalSessionPayload(body?.payload?.clientPayload))
    } catch {
      // Malformed/absent clientPayload — leave sessionId null, fall
      // through to the default (legacy) branch below. The authoritative
      // parse/validation still happens later, unchanged, in
      // onBeforeGenerateToken.
    }

    let resolvedSession = null
    if (sessionId) {
      const prismaForLookup = await getPrismaClient()
      if (prismaForLookup) {
        resolvedSession = await prismaForLookup.blobUploadSession.findUnique({
          where: { id: sessionId },
          select: { uploadKind: true, eventId: true },
        })
      }
    }

    if (resolvedSession?.uploadKind === BlobUploadKind.PHOTOGRAPHER_UPLOAD && resolvedSession.eventId) {
      const photographerBlobLimit = await checkRateLimit(
        `upload-blob:photographer-event:${resolvedSession.eventId}`,
        RATE_LIMITS.photographerBlobEvent.event.max,
        RATE_LIMITS.photographerBlobEvent.event.window,
      )
      if (photographerBlobLimit.limited) {
        return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
      }
    } else if (resolvedSession?.uploadKind === BlobUploadKind.PRIVATE_DELIVERY && resolvedSession.eventId) {
      const privateDeliveryBlobLimit = await checkRateLimit(
        `upload-blob:private-event:${resolvedSession.eventId}`,
        RATE_LIMITS.privateDeliveryBlobEvent.event.max,
        RATE_LIMITS.privateDeliveryBlobEvent.event.window,
      )
      if (privateDeliveryBlobLimit.limited) {
        return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
      }
    } else if (resolvedSession?.uploadKind === BlobUploadKind.ROOM_PHOTO && resolvedSession.eventId) {
      // Deliberately set above guestInitEvent/guestCompleteEvent (1500 >
      // 1000, see RATE_LIMITS.guestBlobEvent) — the Guest client only
      // reaches this stage after a successful init in the same attempt, so
      // this bucket cannot bind before init's under normal traffic.
      const guestBlobLimit = await checkRateLimit(
        `upload-blob:guest-event:${resolvedSession.eventId}`,
        RATE_LIMITS.guestBlobEvent.event.max,
        RATE_LIMITS.guestBlobEvent.event.window,
      )
      if (guestBlobLimit.limited) {
        return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
      }
    } else {
      // Default branch: unresolved or malformed — unchanged legacy shared
      // IP limiter.
      const limit = rateLimit(`upload-blob:ip:${clientIp}`, RATE_LIMITS.uploadBlob.ip.max, RATE_LIMITS.uploadBlob.ip.window)
      if (limit.limited) {
        return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
      }
    }

    try {
      validateBlobUploadCallbackUrl(body, request.url)
    } catch (error) {
      if (error instanceof BlobUploadTokenRequestError) {
        return json({ error: error.publicMessage, code: error.code }, error.status)
      }
      return json({ error: 'Unable to initialize Blob upload' }, 400)
    }
  }

  // 4. Verify Blob token is configured
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return json(
      { error: 'Server misconfiguration: BLOB_READ_WRITE_TOKEN is missing' },
      500,
    )
  }

  if (!isVercelBlobStorageConfigured()) {
    return json({ error: 'Vercel Blob is not configured' }, 500)
  }

  // 5. Build lazy callbacks — independent of step 3b's own eager lookup
  //    (a plain read, no claim). Prisma is resolved here only when
  //    handleUpload invokes onBeforeGenerateToken or onUploadCompleted.
  const callbacks = createLazyServerBoundBlobUploadCallbacks({
    getPrisma: getPrismaClient,
  })

  // 6. Delegate to @vercel/blob handleUpload
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: callbacks.onBeforeGenerateToken,
      onUploadCompleted: callbacks.onUploadCompleted,
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof BlobUploadTokenRequestError) {
      // 503 on database_unavailable lets Vercel retry the callback
      return json({ error: error.publicMessage, code: error.code }, error.status)
    }

    if (error instanceof BlobError) {
      // Invalid signature or malformed Blob request — return static 400
      return json({ error: 'Invalid Blob upload request.' }, 400)
    }

    if (isDatabaseUnavailableError(error)) {
      throw error
    }

    if (callbackRequest) {
      // Unknown error on callback path: rethrow so Vercel can retry
      throw error
    }

    // Unknown error on token-generation path: opaque 400
    console.error('[issueBlobUploadToken] token generation error')
    return json({ error: 'Unable to initialize Blob upload' }, 400)
  }
}
