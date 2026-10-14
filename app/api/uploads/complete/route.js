import { randomUUID } from 'crypto'
import { head } from '@vercel/blob'
import { normalizePhotoRecord } from '@/lib/server/repository-mappers'
import {
  blobUploadSessionCompleteSchema,
  localUploadCompleteSchema,
} from '@/lib/server/schemas'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { withTiming } from '@/lib/server/timing'
import { UploadTokenMismatchError } from '@/lib/server/storage/local-storage'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_FREE_PHOTO_LIMIT_HIT } from '@/lib/analytics/events'
import { BlobUploadKind } from '@prisma/client'
import {
  BlobUploadCompletionError,
  completeRoomPhotoBlobUpload,
} from '@/lib/server/blob-upload-completion'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { deleteStoredFile, getStorageDriver, localStorageDriver } from '@/lib/server/storage'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { validateRoomPhotoSource, PhotoSourceValidationError } from '@/lib/server/photo-source-validation'
import { checkRoomUploadEntitlement } from '@/lib/server/entitlements'
import { ensurePhotoDisplayDerivativeStatus } from '@/lib/server/photo-display-derivative-status'
import { json } from '@/lib/server/api-response'

export const runtime = 'nodejs'

/**
 * Best-effort display-v1 generation for one Photo (STEP 7.15e). Identical
 * thin wrapper to the one kept in app/api/[[...path]]/route.js for the
 * moderation call sites — duplicated here (not imported) because Next.js
 * route modules are not meant to be imported from one another.
 */
async function ensurePhotoDisplayDerivative(photo, { operation, sourceBuffer }) {
  const prisma = await getPrismaClient()
  return ensurePhotoDisplayDerivativeStatus({ prisma, photo, operation, sourceBuffer })
}

// Moved verbatim out of the legacy app/api/[[...path]]/route.js catch-all
// (previously `completeUpload`). Behavior, status codes, and rate limiting
// are unchanged — deliberately NOT wrapped in an extra generic try/catch
// beyond withTiming's own (which rethrows, it never swallows); see the
// comment on app/api/uploads/init/route.js for why that matches the
// original's behavior.
export const POST = withTiming('completeUpload', async (request) => {
  // Broad, Redis-backed, hashed-IP guard — runs before any database access.
  // Guest-exclusive route: distinct from the shared blob-token-broad guard.
  const clientIp = getClientIp(request)
  const broadCompleteLimit = await checkRateLimit(
    `guest-complete-broad:ip:${hashIdentifier(clientIp)}`,
    RATE_LIMITS.guestCompleteBroad.ip.max,
    RATE_LIMITS.guestCompleteBroad.ip.window,
  )
  if (broadCompleteLimit.limited) {
    return json({ error: 'Too many upload completions. Please try again later.' }, 429)
  }

  const body = await request.json()
  const storageDriver = getStorageDriver()

  if (storageDriver.mode === 'vercel-blob') {
    // ── Server-bound Vercel Blob path ─────────────────────────────────────
    let payload
    try {
      payload = blobUploadSessionCompleteSchema.parse(body)
    } catch {
      return json({ error: 'Invalid request body' }, 400)
    }

    const prisma = await getPrismaClient()
    if (
      !prisma ||
      typeof prisma.blobUploadSession !== 'object' ||
      prisma.blobUploadSession === null
    ) {
      return json({ error: 'Upload service is temporarily unavailable.', code: 'database_unavailable' }, 503)
    }

    // Read-only pre-resolution lookup, limiter-identity only — never
    // mutates, never claims the session. completeRoomPhotoBlobUpload below
    // remains the sole authoritative source for session state/claiming.
    // The guest-complete-event bucket must be applied ONLY for resolved
    // ROOM_PHOTO sessions with a real eventId: a Photographer/Private
    // Delivery/unresolved session presented here must not poison this
    // bucket (see STEP 7.13c review correction).
    const resolvedCompleteSession = await prisma.blobUploadSession.findUnique({
      where: { id: payload.sessionId },
      select: { eventId: true, uploadKind: true },
    })

    if (resolvedCompleteSession?.uploadKind === BlobUploadKind.ROOM_PHOTO && resolvedCompleteSession.eventId) {
      const guestCompleteEventLimit = await checkRateLimit(
        `guest-complete-event:${resolvedCompleteSession.eventId}`,
        RATE_LIMITS.guestCompleteEvent.event.max,
        RATE_LIMITS.guestCompleteEvent.event.window,
      )
      if (guestCompleteEventLimit.limited) {
        return json({ error: 'Too many upload completions. Please try again later.' }, 429)
      }
    }

    let result
    try {
      result = await completeRoomPhotoBlobUpload({
        prisma,
        sessionId: payload.sessionId,
        headBlob: (pathname) => head(pathname),
        deleteBlob: (url) => deleteStoredFile(url),
        fetchSourceBuffer: (url) => getPhotoBuffer(url),
        checkEntitlement: checkRoomUploadEntitlement,
      })
    } catch (error) {
      if (error instanceof BlobUploadCompletionError) {
        if (error.code === 'photo_limit' && error.details) {
          trackServerEvent(
            EVENT_FREE_PHOTO_LIMIT_HIT,
            {
              room_slug: error.details.eventSlug,
              event_id: error.details.eventId,
              current_photos: error.details.current,
              limit: error.details.max,
            },
            { distinctId: `room:${error.details.eventSlug}`, personProfile: false },
          )
        }
        return json(
          {
            error: error.publicMessage,
            code: error.code,
            ...(error.details || {}),
          },
          error.status,
        )
      }
      throw error
    }

    // Eager, best-effort, post-commit (STEP 7.15e). `result.photo` is only
    // ever populated once the transaction has committed — including the
    // idempotent-retry branch, which returns the SAME already-committed
    // Photo. Calling this unconditionally (not only when `!idempotent`) is
    // deliberate: a retry after a first-attempt generation failure gets
    // another chance for free, and a retry after success costs only one
    // Blob `head` thanks to the ensure-mode cache-HIT path.
    //
    // result.sourceBuffer (STEP 7.15g) is the exact buffer already fetched
    // and validated during completion — present only on a fresh (non-
    // idempotent) success, undefined on the idempotent path, in which case
    // this falls back to its own fetch exactly as before.
    await ensurePhotoDisplayDerivative(result.photo, { operation: 'completeUpload', sourceBuffer: result.sourceBuffer })

    const repository = await getGalleryRepository()
    const freshEvent = await repository.getEventBySlug(result.eventSlug)

    return json(
      {
        // normalizePhotoRecord strips server-only attribution metadata
        // (uploadActorType) before this reaches the client — parity with
        // the local-upload path, where repository.createPhoto() already
        // normalizes its return value the same way.
        photo: normalizePhotoRecord(result.photo),
        event: freshEvent,
        idempotent: result.idempotent,
      },
      result.idempotent ? 200 : 201,
    )
  }

  // ── Local (chunked) upload path ───────────────────────────────────────────
  const repository = await getGalleryRepository()
  const prisma = await getPrismaClient()

  const payload = localUploadCompleteSchema.parse(body)
  let fileResult
  try {
    fileResult = await localStorageDriver.completeUploadSession({
      sessionId: payload.sessionId,
      uploadToken: payload.uploadToken,
      photoId: randomUUID(),
    })
  } catch (error) {
    if (error instanceof UploadTokenMismatchError) {
      return json({ error: 'Invalid upload session' }, 403)
    }
    throw error
  }

  const event = await repository.getEventBySlug(fileResult.eventSlug)

  if (!event) {
    return json({ error: 'Event not found while finalizing upload' }, 404)
  }

  // Final guard: enforce photo limit for Free rooms
  if (prisma) {
    const entitlement = await checkRoomUploadEntitlement(prisma, event)
    if (!entitlement.allowed) {
      trackServerEvent(
        EVENT_FREE_PHOTO_LIMIT_HIT,
        {
          room_slug: event.slug,
          event_id: event.id,
          current_photos: entitlement.current,
          limit: entitlement.max,
        },
        { distinctId: `room:${event.slug}`, personProfile: false }
      )
      return json({
        error: `This room has reached its ${entitlement.max}-photo limit.`,
        limit: 'photo_count',
        current: entitlement.current,
        max: entitlement.max,
        upgradePath: entitlement.upgradePath,
      }, 403)
    }
  }

  // Source-integrity validation (STEP 7.15g) — parity with the Blob path.
  // Reads the just-assembled file exactly once; reused below for eager
  // display generation instead of a second read. Dev-only in practice
  // (localStorageDriver refuses to run under VERCEL), but the same
  // content-integrity contract applies here as on the Blob path.
  let localSourceBuffer
  try {
    localSourceBuffer = await getPhotoBuffer(fileResult.url)
  } catch {
    return json({ error: 'Upload service is temporarily unavailable.', code: 'image_validation_unavailable' }, 503)
  }

  let validatedLocalSource
  try {
    validatedLocalSource = await validateRoomPhotoSource(localSourceBuffer, { declaredMimeType: fileResult.mimeType })
  } catch (error) {
    if (error instanceof PhotoSourceValidationError) {
      const code = error.code === 'IMAGE_CONTENT_TYPE_MISMATCH' ? 'image_content_type_mismatch' : 'invalid_image_content'
      return json({ error: 'This file could not be processed as an image.', code }, 422)
    }
    throw error
  }

  const photo = await repository.createPhoto({
    eventId: event.id,
    originalName: fileResult.originalName,
    storedName: fileResult.storedName,
    mimeType: validatedLocalSource.actualMimeType,
    size: validatedLocalSource.size,
    url: fileResult.url,
    uploaderName: payload.uploaderName,
    caption: payload.caption,
    momentId: payload.momentId || undefined,
    // Unlike uploaderName/caption/momentId above, contributorId is read
    // exclusively from the session (fileResult, sourced from meta.json at
    // init time) — never from this complete-request body — for parity with
    // the Vercel Blob path's session-authoritative contract.
    contributorId: fileResult.contributorId,
    // Same session-authoritative contract as contributorId: uploadActorType
    // was resolved server-side at init time and must never be re-derived or
    // accepted from this completion request body.
    uploadActorType: fileResult.uploadActorType,
  })

  // Eager, best-effort, post-commit (STEP 7.15e) — parity with the Blob path.
  // `createPhoto` has already resolved successfully above, so `photo.id`/
  // `photo.url` are for a durably-committed row. Reuses the same buffer
  // already fetched and validated above — no second read.
  await ensurePhotoDisplayDerivative(photo, { operation: 'completeUpload', sourceBuffer: localSourceBuffer })

  const freshEvent = await repository.getEventBySlug(event.slug)

  return json({
    photo,
    event: freshEvent,
  }, 201)
})

export async function OPTIONS() {
  return json({ ok: true })
}
