import { createHash, randomUUID } from 'crypto'
import { head } from '@vercel/blob'
import {
  generateManagementToken,
  hashManagementToken,
  verifyManagementToken,
} from '@/lib/server/management-token'
import {
  generatePhotographerUploadToken,
  hashPhotographerUploadToken,
  verifyPhotographerUploadToken,
} from '@/lib/server/photographer-token'
import { NextResponse } from 'next/server'
import { resend } from '@/lib/server/resend-client'
import { buildEmail } from '@/lib/server/email/email-layout'
import {
  adminMetricsRangeSchema,
  adminModerationSchema,
  adminPasswordSchema,
  blobUploadSessionCompleteSchema,
  createPhotographerUploadLinkSchema,
  MAX_FILE_SIZE_BYTES,
  MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES,
  privateDeliveryLocalUploadCompleteSchema,
  privateDeliveryUploadInitSchema,
  slugify,
  updateEventSchema,
} from '@/lib/server/schemas'
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  getAdminAuthStatus,
  getAdminCookieOptions,
  setupLocalAdminPassword,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from '@/lib/server/admin-auth'
import {
  OWNER_COOKIE_NAME,
  createOwnerSessionToken,
  createRecoveryToken,
  createSetupToken,
  getOwnerCookieOptions,
  hashPasswordResetToken,
  verifyOwnerSessionToken,
  verifyRecoveryToken,
  verifySetupToken,
} from '@/lib/server/owner-auth'
import {
  createPasswordResetTokenForOwner,
  findValidPasswordResetToken,
} from '@/lib/server/password-reset-tokens'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import { PhotographerLinkLimitError } from '@/lib/server/prisma-gallery-repository'
import { createPasswordHash, verifyPassword, validatePassword } from '@/lib/server/owner-password'
import {
  checkRateLimit,
  rateLimit,
  getClientIp,
  hashIdentifier,
  AUTH_LIMITS,
  RATE_LIMITS,
  OWNER_WRITE_LIMITS,
  ADMIN_LIMITS,
} from '@/lib/server/rate-limiter'
import { requireCsrfProtection, verifySameOriginRequest } from '@/lib/server/csrf'
import { withTiming } from '@/lib/server/timing'
import { UploadTokenMismatchError } from '@/lib/server/storage/local-storage'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { getOwnerAnalyticsId } from '@/lib/analytics/identity'
import { getTrafficMetrics } from '@/lib/server/admin-analytics-posthog'
import { PostHogQueryError, POSTHOG_ERROR } from '@/lib/server/posthog-query'
import { getAdminBusinessMetrics } from '@/lib/server/admin-business-dashboard'
import {
  EVENT_OWNER_CLAIM_COMPLETED,
  EVENT_OWNER_LOGGED_IN,
  EVENT_RATE_LIMIT_HIT,
  EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED,
  EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED,
  EVENT_PRIVATE_DELIVERY_DELETED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED,
  EVENT_PHOTOGRAPHER_UPLOAD_STARTED,
  EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED,
  EVENT_PHOTOGRAPHER_UPLOAD_FAILED,
} from '@/lib/analytics/events'
import { BlobUploadKind } from '@prisma/client'
import { createServerBoundBlobUploadInit } from '@/lib/server/blob-upload-init'
import {
  BlobUploadCompletionError,
  completePrivateAssetBlobUpload,
} from '@/lib/server/blob-upload-completion'
import { handleBlobUploadTokenRequest } from '@/lib/server/blob-upload-token-route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import {
  deleteStoredFile,
  getStoredNameFromBlobPathname,
  getStorageDriver,
  localStorageDriver,
} from '@/lib/server/storage'
import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'
import { deletePhotoDerivatives } from '@/lib/server/derivative-cleanup'
import { ensurePhotoDisplayDerivativeStatus } from '@/lib/server/photo-display-derivative-status'
import { serializeProviderError } from '@/lib/server/safe-log'
import { checkPrivateDeliveryEntitlement } from '@/lib/server/entitlements'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'
import {
  deleteManagedEventCover,
  getCoverStoragePath,
  optimizeCoverBuffer,
} from '@/lib/server/event-cover-storage'
import {
  routeRoot,
  listEvents,
  createEvent,
  getEvent,
  getAppUrl,
  cleanupBlobsAfterEventDelete,
} from '@/lib/server/event-routes'

export const runtime = 'nodejs'
// Event deletion can walk the authoritative (uncapped) source inventory
// sequentially — Production's largest observed event has 186 photos plus
// private assets and derivatives — so the default duration is too tight.
// 60s matches the ceiling already proven by app/api/download/gallery/route.js.
export const maxDuration = 60

const json = (payload, status = 200) => {
  const response = NextResponse.json(payload, { status })
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return response
}

// Response helper for SESSION_ONLY (cookie-based admin/owner) endpoints.
// These are only ever meant to be called same-origin by the SnapRooms
// frontend, so they must not advertise any cross-origin CORS support.
const jsonPrivate = (payload, status = 200) => {
  return NextResponse.json(payload, { status })
}

// A few SESSION_ONLY admin endpoints delegate their response construction to
// shared handlers that are also the direct PUBLIC handler for the equivalent
// guest-facing route (e.g. listAdminEvents delegates to the same listEvents()
// used by GET /events). Those shared handlers must stay on json() so the
// PUBLIC route keeps its current CORS behavior; this helper strips the CORS
// headers back off only at the SESSION_ONLY wrapper, after admin auth has
// already been verified, without touching the shared PUBLIC handler itself.
const stripPublicCorsHeaders = (response) => {
  response.headers.delete('Access-Control-Allow-Origin')
  response.headers.delete('Access-Control-Allow-Methods')
  response.headers.delete('Access-Control-Allow-Headers')
  return response
}

const formatZodError = (error) => {
  return error.issues?.map((issue) => issue.message).join(', ') || 'Invalid request payload'
}

const isDatabaseUnavailableError = (error) => {
  return error?.code === 'P1001' || error?.code === 'P1002' || error?.code === 'P1008'
}

const getSafeDbErrorMessage = (error, route) => {
  if (isDatabaseUnavailableError(error)) {
    const isLoginRoute = route === '/owner/login' || route === '/owner/session'
    return isLoginRoute
      ? 'Login temporarily unavailable. Please try again shortly.'
      : 'Service temporarily unavailable'
  }
  return 'Internal server error'
}

const logDbError = (error, route, startTime) => {
  const durationMs = startTime ? Date.now() - startTime : null
  const safeMessage = error?.message
    ? String(error.message).replace(/\b\w+:\/\/[^\s]+/g, '[REDACTED]').substring(0, 200)
    : 'unknown'
  console.error(
    `[db-unavailable] route=${route} code=${error?.code || 'unknown'} name=${error?.name || 'unknown'} durationMs=${durationMs ?? 'unknown'} message=${safeMessage}`
  )
}

const getSegments = (params) => params?.path || []

const getAdminAuthentication = async (request) => {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  return verifyAdminSessionToken(token)
}

const requireAdmin = async (request) => {
  const authenticated = await getAdminAuthentication(request)
  return authenticated ? null : jsonPrivate({ error: 'Admin authentication required' }, 401)
}

const setAdminSessionCookie = async (response) => {
  response.cookies.set(ADMIN_COOKIE_NAME, await createAdminSessionToken(), getAdminCookieOptions())
  return response
}

const clearAdminSessionCookie = (response) => {
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    ...getAdminCookieOptions(),
    maxAge: 0,
  })
  return response
}

const getOwnerAuthentication = async (request) => {
  const token = request.cookies.get(OWNER_COOKIE_NAME)?.value
  return verifyOwnerSessionToken(token)
}

const requireOwner = async (request) => {
  const email = await getOwnerAuthentication(request)
  return email ? email : jsonPrivate({ error: 'Owner authentication required' }, 401)
}

const requireOwnerWithCsrf = async (request) => {
  const email = await requireOwner(request)
  if (typeof email !== 'string') return email
  const csrf = requireCsrfProtection(request, email)
  if (!csrf.success) {
    return jsonPrivate({ error: csrf.message, code: csrf.code }, csrf.status)
  }
  return email
}

const requireAdminWithCsrf = async (request) => {
  const adminError = await requireAdmin(request)
  if (adminError) return adminError
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  const adminSession = token ? await verifyAdminSessionToken(token) : null
  const subject = `admin:${adminSession?.id || adminSession?.email || 'session'}`
  const csrf = requireCsrfProtection(request, subject)
  if (!csrf.success) {
    return jsonPrivate({ error: csrf.message, code: csrf.code }, csrf.status)
  }
  return null
}

const buildRateLimitResponse = (result) => {
  const response = json(
    {
      error: 'Too many requests. Please try again later.',
      code: 'rate_limited',
      retryAfter: result.retryAfter,
    },
    429
  )
  response.headers.set('Retry-After', String(result.retryAfter))
  return response
}

// AUTH_CRITICAL-only: returned when checkRateLimit() reports backendError,
// i.e. Redis is configured but failed at runtime for this check. Uses
// jsonPrivate() (not json()) because every caller of this helper is a
// SESSION_ONLY endpoint. Never exposes Redis/Upstash or the raw error.
const buildRateLimitBackendErrorResponse = () => {
  const response = jsonPrivate(
    {
      error: 'Authentication temporarily unavailable. Please try again shortly.',
      code: 'rate_limit_backend_unavailable',
    },
    503,
  )
  response.headers.set('Retry-After', '30')
  return response
}

const checkOwnerRateLimit = async (request, ownerEmail, limitConfig) => {
  const clientIp = getClientIp(request)
  if (limitConfig.owner && ownerEmail) {
    const key = `owner:${limitConfig.scope}:${hashIdentifier(ownerEmail)}`
    const result = await checkRateLimit(key, limitConfig.owner.max, limitConfig.owner.window)
    if (result.limited) return buildRateLimitResponse(result)
  }
  if (limitConfig.ip) {
    const key = `ip:${limitConfig.scope}:${hashIdentifier(clientIp)}`
    const result = await checkRateLimit(key, limitConfig.ip.max, limitConfig.ip.window)
    if (result.limited) return buildRateLimitResponse(result)
  }
  return null
}

const checkAdminRateLimit = async (request, limitConfig) => {
  const clientIp = getClientIp(request)
  if (limitConfig.ip) {
    const key = `admin-ip:${hashIdentifier(clientIp)}`
    const result = await checkRateLimit(key, limitConfig.ip.max, limitConfig.ip.window)
    if (result.limited) return buildRateLimitResponse(result)
  }
  if (limitConfig.admin) {
    const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
    const key = `admin:${hashIdentifier(token || 'unknown')}`
    const result = await checkRateLimit(key, limitConfig.admin.max, limitConfig.admin.window)
    if (result.limited) return buildRateLimitResponse(result)
  }
  return null
}

const setOwnerSessionCookie = async (response, ownerOrEmail) => {
  response.cookies.set(OWNER_COOKIE_NAME, await createOwnerSessionToken(ownerOrEmail), getOwnerCookieOptions())
  return response
}

const clearOwnerSessionCookie = (response) => {
  response.cookies.set(OWNER_COOKIE_NAME, '', {
    ...getOwnerCookieOptions(),
    maxAge: 0,
  })
  return response
}

// Returns { event, link } for a live (non-revoked, non-expired) photographer
// link, or null. Replaces the old single-token-per-event lookup now that an
// event can have several independent PhotographerUploadLink rows.
const getPhotographerLinkFromToken = async (token) => {
  if (!token) return null
  const repository = await getGalleryRepository()
  const tokenHash = hashPhotographerUploadToken(token)
  return repository.getPhotographerLinkByTokenHash(tokenHash)
}

/**
 * Best-effort display-v1 generation for one Photo (STEP 7.15e).
 *
 * Shared by every call site that needs it — new-photo upload completion AND
 * moderation transitions back to VISIBLE — so there is exactly one
 * source-fetch/try-catch/safe-log implementation, not one per caller.
 *
 * MUST be called only after the Photo row has already committed: this
 * function creates a real public Blob object keyed by `photo.id`, so calling
 * it for a Photo that does not durably exist would be pointless at best and
 * orphan a display object at worst. A failure here is cache materialization
 * failing, not the Photo write failing — it must never be allowed to turn a
 * successful upload or moderation decision into an HTTP failure, so it is
 * always caught here and never rethrown.
 *
 * @param {{id: string, url: string}} photo
 * @param {{operation: string, sourceBuffer?: Buffer}} context   log label only — never
 *   logged verbatim with anything sensitive. `sourceBuffer`, when given (STEP
 *   7.15g — the buffer already fetched+validated during upload completion),
 *   is reused as-is instead of a second fetch; omitted on every other call
 *   site (moderation, idempotent retries), which still fetch normally.
 * @returns {Promise<{created: boolean}>} `created:false` on a cache HIT or
 *   on any failure — TASK-02: the two are no longer conflated in the
 *   database. A cache HIT (derivative already existed) and a successful
 *   fresh transform both record `displayDerivativeStatus: READY`; a
 *   thrown error records `FAILED`. A failure to record either status (the
 *   photo row vanishing between commit and this call, a transient DB
 *   error) is itself swallowed — this function's job is cache/status
 *   materialization, never a reason to fail the caller's HTTP response.
 */
async function ensurePhotoDisplayDerivative(photo, { operation, sourceBuffer }) {
  const prisma = await getPrismaClient()
  // TASK-03 (Phase 1A): the READY/FAILED recording logic now lives in
  // lib/server/photo-display-derivative-status.js, shared with the legacy
  // backfill mechanism. Behavior here is unchanged — same signature, same
  // fallback to getPhotoBuffer(photo.url) when sourceBuffer is omitted,
  // same swallow-and-log contract.
  return ensurePhotoDisplayDerivativeStatus({ prisma, photo, operation, sourceBuffer })
}

const listPrivateDeliveryAssets = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (ownerEmail?.error) return ownerEmail

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return jsonPrivate({ error: 'Private delivery is not available for this room', upgradePath: 'wedding_pro' }, 403)
    }
  }

  const assets = await repository.listPrivateAssetsByEventId(event.id)
  return jsonPrivate({ assets })
}

const initPrivateDeliveryUpload = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.privateDeliveryWrite)
  if (rateLimitCheck) return rateLimitCheck

  const payload = privateDeliveryUploadInitSchema.parse(await request.json())
  if (payload.eventSlug !== slug) {
    return jsonPrivate({ error: 'Room slug mismatch' }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return jsonPrivate({ error: 'Private delivery is not available for this room', upgradePath: 'wedding_pro' }, 403)
    }
  }

  const storageDriver = getStorageDriver()
  let session

  if (storageDriver.mode === 'vercel-blob') {
    if (!prisma) {
      return jsonPrivate(
        { error: 'Database is required for secure Blob uploads' },
        503,
      )
    }

    session = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver,
      event,
      payload,
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      handleUploadUrl: '/api/uploads/blob',
    })
  } else {
    session = await storageDriver.initUploadSession({ ...payload, directory: 'private-delivery' })
  }

  trackServerEvent(
    EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED,
    { room_slug: slug, file_size: payload.fileSize },
    { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
  )

  return jsonPrivate({ session }, 201)
}

const issuePrivateDeliveryBlobToken = async (request) => {
  return handleBlobUploadTokenRequest(request)
}

const completePrivateDeliveryUpload = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.privateDeliveryWrite)
  if (rateLimitCheck) return rateLimitCheck

  const body = await request.json()
  const repository = await getGalleryRepository()
  const prisma = await getPrismaClient()

  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const storageDriver = getStorageDriver()

  if (storageDriver.mode === 'vercel-blob') {
    // Entitlement is enforced exclusively by completePrivateAssetBlobUpload's
    // transaction below (checkPrivateDeliveryEntitlement), which also runs
    // safeCleanup() on a newly-uploaded blob when entitlement was revoked
    // between init and complete — a route-level pre-check here would only
    // duplicate that logic while bypassing its compensating cleanup.
    // ── Server-bound Vercel Blob path ───────────────────────────────────────
    let payload
    try {
      payload = blobUploadSessionCompleteSchema.parse(body)
    } catch {
      return jsonPrivate({ error: 'Invalid request body' }, 400)
    }

    if (
      !prisma ||
      typeof prisma.blobUploadSession !== 'object' ||
      prisma.blobUploadSession === null
    ) {
      return jsonPrivate({ error: 'Upload service is temporarily unavailable.', code: 'database_unavailable' }, 503)
    }

    let result
    try {
      result = await completePrivateAssetBlobUpload({
        prisma,
        sessionId: payload.sessionId,
        expectedEventId: event.id,
        expectedEventSlug: event.slug,
        expectedUploadKind: BlobUploadKind.PRIVATE_DELIVERY,
        headBlob: (pathname) => head(pathname),
        deleteBlob: (url) => deleteStoredFile(url),
        checkEntitlement: checkPrivateDeliveryEntitlement,
      })
    } catch (error) {
      if (error instanceof BlobUploadCompletionError) {
        return jsonPrivate(
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

    if (!result.idempotent) {
      trackServerEvent(
        EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED,
        { room_slug: event.slug, asset_id: result.asset.id, file_size: result.asset.size },
        { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
      )
    }

    return jsonPrivate(
      {
        asset: result.asset,
        idempotent: result.idempotent,
      },
      result.idempotent ? 200 : 201,
    )
  }

  // ── Local upload path ─────────────────────────────────────────────────────
  // completePrivateAssetBlobUpload (and its entitlement enforcement) is
  // Vercel-Blob-only, so the local storage path must still check entitlement
  // itself here — this is not a duplicate of anything above for this branch.
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return jsonPrivate({ error: 'Private delivery is not available for this room', upgradePath: 'wedding_pro' }, 403)
    }
  }

  const payload = privateDeliveryLocalUploadCompleteSchema.parse(body)
  let fileResult
  try {
    fileResult = await localStorageDriver.completeUploadSession({
      sessionId: payload.sessionId,
      uploadToken: payload.uploadToken,
      photoId: randomUUID(),
    })
  } catch (error) {
    if (error instanceof UploadTokenMismatchError) {
      return jsonPrivate({ error: 'Invalid upload session' }, 403)
    }
    throw error
  }

  if (fileResult.eventSlug !== slug) {
    return jsonPrivate({ error: 'Room slug mismatch' }, 400)
  }

  const asset = await repository.createPrivateAsset({
    eventId: event.id,
    originalName: fileResult.originalName,
    storedName: fileResult.storedName,
    mimeType: fileResult.mimeType,
    size: fileResult.size,
    url: fileResult.url,
  })

  trackServerEvent(
    EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED,
    { room_slug: slug, asset_id: asset.id, file_size: fileResult.size },
    { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
  )

  return jsonPrivate({ asset }, 201)
}

const deletePrivateDeliveryAsset = async (request, assetId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.privateDeliveryWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const prisma = await getPrismaClient()

  const asset = await repository.getPrivateAssetById(assetId)
  if (!asset) {
    return jsonPrivate({ error: 'Asset not found' }, 404)
  }

  const event = await prisma?.event.findUnique({ where: { id: asset.eventId } })
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const normalizedEmail = ownerEmail.toLowerCase().trim()
  const owner = await resolveCanonicalOwner(ownerEmail)
  const isOwner =
    event?.ownerEmail?.toLowerCase() === normalizedEmail ||
    (owner && event?.ownerId === owner.id)

  if (!isOwner) {
    return jsonPrivate({ error: 'Owner authentication required' }, 403)
  }

  try {
    await deleteEventScopedStoredFile({ url: asset.url, eventSlug: event?.slug || '', kind: 'private-asset', deleteFile: deleteStoredFile })
  } catch (storageError) {
    console.error('[deletePrivateDeliveryAsset] Storage cleanup failed:', assetId, serializeProviderError('blob', 'delete_private_delivery_asset', storageError))
  }

  await repository.deletePrivateAssetById(assetId)

  trackServerEvent(
    EVENT_PRIVATE_DELIVERY_DELETED,
    { room_slug: event.slug, asset_id: assetId },
    { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
  )

  return jsonPrivate({ deleted: true })
}

const createPhotographerUploadLink = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.photographerLinkWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return jsonPrivate({ error: 'Private delivery is not available for this room', upgradePath: 'wedding_pro' }, 403)
    }
  }

  let label = null
  try {
    const body = await request.json().catch(() => ({}))
    label = createPhotographerUploadLinkSchema.parse(body).label ?? null
  } catch (zodError) {
    return jsonPrivate({ error: formatZodError(zodError) }, 400)
  }

  const token = generatePhotographerUploadToken()
  const tokenHash = hashPhotographerUploadToken(token)

  let link
  try {
    link = await repository.createPhotographerUploadLink(event.id, { tokenHash, label })
  } catch (error) {
    if (error instanceof PhotographerLinkLimitError) {
      return jsonPrivate({ error: error.message }, 400)
    }
    throw error
  }

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
    { room_slug: slug },
    { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
  )

  const appUrl = getAppUrl(request)
  if (!appUrl) {
    return jsonPrivate({ error: 'Unable to create upload link. Please try again later.' }, 500)
  }
  return jsonPrivate({ linkId: link.id, label: link.label, token, url: `${appUrl}/photographer-upload/${token}` })
}

const listPhotographerUploadLinksHandler = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const links = await repository.listPhotographerUploadLinks(event.id)
  return jsonPrivate({
    links: links.map(({ id, label, createdAt, expiresAt, revokedAt, photoCount }) => ({
      id,
      label,
      createdAt,
      expiresAt,
      revokedAt,
      photoCount,
    })),
  })
}

const deletePhotographerUploadLink = async (request, slug, linkId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.photographerLinkWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  const revoked = await repository.revokePhotographerUploadLink(event.id, linkId)
  if (!revoked) {
    return jsonPrivate({ error: 'Photographer link not found' }, 404)
  }

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED,
    { room_slug: slug },
    { distinctId: getOwnerAnalyticsId(event.ownerId), personProfile: true }
  )

  return jsonPrivate({ revoked: true })
}

const uploadEventCover = withTiming('uploadEventCover', async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.coverUpload)
  if (rateLimitCheck) return rateLimitCheck

  // A second, redundant rate-limit check used to run here, keyed by raw
  // ownerEmail/clientIp through the deprecated in-memory rateLimit()
  // helper — RATE_LIMITS.coverUpload carries identical owner/ip thresholds
  // to OWNER_WRITE_LIMITS.coverUpload above, so it added no protection,
  // only a PII-bearing key. Removed rather than patched.

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const { coverDataUrl } = body
  if (!coverDataUrl || !coverDataUrl.startsWith('data:image/')) {
    return jsonPrivate({ error: 'Invalid cover image. Must be a valid image data URL.' }, 400)
  }

  const match = coverDataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.*)$/)
  if (!match) {
    return jsonPrivate({ error: 'Unsupported image format. Use JPEG, PNG, or WebP.' }, 400)
  }

  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > 10 * 1024 * 1024) {
    return jsonPrivate({ error: 'Image too large. Max 10MB.' }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  try {
    const { put } = await import('@vercel/blob')

    // Optimize for dashboard/card usage (1200×675 WebP q80).
    // Falls back to original buffer if sharp is unavailable or fails.
    const optimized = await optimizeCoverBuffer(buffer, { width: 1200, height: 675, quality: 80 })

    const ext = optimized ? 'webp' : (match[1] === 'jpg' ? 'jpeg' : match[1])
    const contentType = optimized ? 'image/webp' : `image/${ext}`
    const uploadBuffer = optimized ? optimized.buffer : buffer
    const pathname = getCoverStoragePath(slug, `${Date.now()}-cover.${ext}`)

    const blob = await put(pathname, uploadBuffer, {
      access: 'public',
      contentType,
    })

    try {
      const oldCoverUrl = event.coverUrl
      const updatedEvent = await repository.updateEvent(slug, { coverUrl: blob.url })

      if (oldCoverUrl) {
        await deleteManagedEventCover(oldCoverUrl, slug)
      }

      console.log(
        `[uploadEventCover] slug=${slug} input=${buffer.length} output=${uploadBuffer.length} format=${ext}`
      )

      return jsonPrivate({ event: updatedEvent })
    } catch (dbError) {
      // Compensating cleanup: the blob above was written successfully but
      // never persisted to the event record, so it would otherwise be
      // permanently orphaned (cover blobs have no BlobUploadSession and are
      // therefore invisible to the cleanup cron). pathname is unique per
      // request (Date.now() plus Vercel's own random suffix), so no other
      // request or session can reference this exact blob.url — safe to
      // delete unconditionally, without any concurrent-claim check.
      try {
        await deleteStoredFile(blob.url)
      } catch {
        console.error('[uploadEventCover] Compensating cleanup failed after updateEvent error')
      }
      throw dbError
    }
  } catch (storageError) {
    console.error('[uploadEventCover] Storage error:', serializeProviderError('blob', 'upload_event_cover', storageError))
    return jsonPrivate({ error: 'Unable to save cover image. Please try again.' }, 500)
  }
})

const deleteEventCover = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.coverDelete)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  if (event.coverUrl) {
    try {
      await deleteManagedEventCover(event.coverUrl, slug)
    } catch (storageError) {
      // event.coverUrl is a full Blob URL — never logged; slug identifies
      // the event just as well for on-call debugging.
      console.error('[deleteEventCover] Storage cleanup failed for cover:', slug, serializeProviderError('blob', 'delete_event_cover', storageError))
    }
  }

  const updatedEvent = await repository.updateEvent(slug, { coverUrl: null })
  return jsonPrivate({ event: updatedEvent })
}

const MAX_MOMENTS_PER_EVENT = 12

const listOwnerEventMoments = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  const moments = await repository.listEventMoments(event.id)
  return jsonPrivate({ moments })
}

const createOwnerEventMoment = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.momentsWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  const count = await repository.countEventMoments(event.id)
  if (count >= MAX_MOMENTS_PER_EVENT) {
    return jsonPrivate({ error: `Maximum ${MAX_MOMENTS_PER_EVENT} moments allowed` }, 400)
  }

  const body = await request.json()
  const name = String(body.name || '').trim()
  if (!name || name.length > 40) {
    return jsonPrivate({ error: 'Moment name must be between 1 and 40 characters' }, 400)
  }

  const slugBase = slugify(name)
  const existing = await repository.listEventMoments(event.id)
  let momentSlug = slugBase
  let suffix = 2
  while (existing.some((m) => m.slug === momentSlug)) {
    momentSlug = `${slugBase}-${suffix}`
    suffix += 1
  }

  const sortOrder = existing.length
  const moment = await repository.createEventMoment(event.id, {
    name,
    slug: momentSlug,
    sortOrder,
  })

  return jsonPrivate({ moment }, 201)
}

const updateOwnerEventMoment = async (request, slug, momentId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.momentsWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  const body = await request.json()
  const updates = {}
  if (body.name !== undefined) {
    const name = String(body.name || '').trim()
    if (!name || name.length > 40) {
      return jsonPrivate({ error: 'Moment name must be between 1 and 40 characters' }, 400)
    }
    updates.name = name
  }
  if (body.sortOrder !== undefined) {
    updates.sortOrder = parseInt(body.sortOrder, 10)
  }

  const moment = await repository.updateEventMoment(momentId, updates)
  return jsonPrivate({ moment })
}

const deleteOwnerEventMoment = async (request, slug, momentId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.momentsWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  await repository.deleteEventMoment(momentId)
  return jsonPrivate({ success: true })
}

const getPhotographerUploadEvent = async (request, token) => {
  const resolved = await getPhotographerLinkFromToken(token)
  if (!resolved) {
    return json({ error: 'Invalid or expired link' }, 403)
  }
  const { event } = resolved

  const prisma = await getPrismaClient()
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return json({ error: 'Private delivery is not available for this room' }, 403)
    }
  }

  return json({ event: { id: event.id, name: event.name, slug: event.slug } })
}

const initPhotographerUpload = async (request, token) => {
  // The raw token is attacker-controlled until
  // getPhotographerLinkFromToken() validates it below (a DB lookup) — so
  // a broad, hashed-IP guard must run BEFORE both the token-hash bucket
  // and that lookup, bounding arbitrary-token cardinality pre-DB.
  const clientIp = getClientIp(request)
  const broadInitLimit = await checkRateLimit(
    `photographer-init-broad:ip:${hashIdentifier(clientIp)}`,
    RATE_LIMITS.photographerInitBroad.ip.max,
    RATE_LIMITS.photographerInitBroad.ip.window,
  )
  if (broadInitLimit.limited) {
    return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
  }

  const photographerTokenHash = hashPhotographerUploadToken(token)
  const initLimit = await checkRateLimit(
    `photographer-init:token:${photographerTokenHash}`,
    RATE_LIMITS.photographerInit.token.max,
    RATE_LIMITS.photographerInit.token.window,
  )
  if (initLimit.limited) {
    return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
  }

  const resolved = await getPhotographerLinkFromToken(token)
  if (!resolved) {
    return json({ error: 'Invalid or expired link' }, 403)
  }
  const { event } = resolved

  const payload = privateDeliveryUploadInitSchema.parse(await request.json())
  if (payload.eventSlug !== event.slug) {
    return json({ error: 'Room slug mismatch' }, 400)
  }

  const prisma = await getPrismaClient()
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return json({ error: 'Private delivery is not available for this room' }, 403)
    }
  }

  const storageDriver = getStorageDriver()
  let session

  if (storageDriver.mode === 'vercel-blob') {
    if (!prisma) {
      return json(
        { error: 'Database is required for secure Blob uploads' },
        503,
      )
    }

    session = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver,
      event,
      payload,
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      handleUploadUrl: '/api/uploads/blob',
    })
  } else {
    session = await storageDriver.initUploadSession({ ...payload, directory: 'private-delivery' })
  }

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_STARTED,
    { room_slug: event.slug, file_size: payload.fileSize },
    { distinctId: `room:${event.slug}`, personProfile: false }
  )

  return json({ session }, 201)
}

const issuePhotographerBlobToken = async (request) => {
  return handleBlobUploadTokenRequest(request)
}

const completePhotographerUpload = async (request, token) => {
  // Same pre-auth cardinality guard as initPhotographerUpload — its own
  // separate 1000/IP category so a normal one-init-plus-one-complete
  // upload never double-charges against a single combined ceiling.
  const clientIp = getClientIp(request)
  const broadCompleteLimit = await checkRateLimit(
    `photographer-complete-broad:ip:${hashIdentifier(clientIp)}`,
    RATE_LIMITS.photographerCompleteBroad.ip.max,
    RATE_LIMITS.photographerCompleteBroad.ip.window,
  )
  if (broadCompleteLimit.limited) {
    return json({ error: 'Too many upload completions. Please try again later.' }, 429)
  }

  const photographerTokenHash = hashPhotographerUploadToken(token)
  const completeLimit = await checkRateLimit(
    `photographer-complete:token:${photographerTokenHash}`,
    RATE_LIMITS.photographerComplete.token.max,
    RATE_LIMITS.photographerComplete.token.window,
  )
  if (completeLimit.limited) {
    return json({ error: 'Too many upload completions. Please try again later.' }, 429)
  }

  const resolved = await getPhotographerLinkFromToken(token)
  if (!resolved) {
    return json({ error: 'Invalid or expired link' }, 403)
  }
  const { event, link } = resolved

  const body = await request.json()
  const repository = await getGalleryRepository()
  const prisma = await getPrismaClient()

  const storageDriver = getStorageDriver()

  if (storageDriver.mode === 'vercel-blob') {
    // Entitlement is enforced exclusively by completePrivateAssetBlobUpload's
    // transaction below (checkPrivateDeliveryEntitlement), which also runs
    // safeCleanup() on a newly-uploaded blob when entitlement was revoked
    // between init and complete — a route-level pre-check here would only
    // duplicate that logic while bypassing its compensating cleanup.
    // ── Server-bound Vercel Blob path ───────────────────────────────────────
    let payload
    try {
      payload = blobUploadSessionCompleteSchema.parse(body)
    } catch {
      return json({ error: 'Invalid request body' }, 400)
    }

    if (
      !prisma ||
      typeof prisma.blobUploadSession !== 'object' ||
      prisma.blobUploadSession === null
    ) {
      return json({ error: 'Upload service is temporarily unavailable.', code: 'database_unavailable' }, 503)
    }

    let result
    try {
      result = await completePrivateAssetBlobUpload({
        prisma,
        sessionId: payload.sessionId,
        expectedEventId: event.id,
        expectedEventSlug: event.slug,
        expectedUploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
        photographerLinkId: link.id,
        headBlob: (pathname) => head(pathname),
        deleteBlob: (url) => deleteStoredFile(url),
        checkEntitlement: checkPrivateDeliveryEntitlement,
      })
    } catch (error) {
      if (error instanceof BlobUploadCompletionError) {
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

    if (!result.idempotent) {
      trackServerEvent(
        EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED,
        { room_slug: event.slug, asset_id: result.asset.id, file_size: result.asset.size },
        { distinctId: `room:${event.slug}`, personProfile: false }
      )
    }

    return json(
      {
        asset: result.asset,
        idempotent: result.idempotent,
      },
      result.idempotent ? 200 : 201,
    )
  }

  // ── Local upload path ─────────────────────────────────────────────────────
  // completePrivateAssetBlobUpload (and its entitlement enforcement) is
  // Vercel-Blob-only, so the local storage path must still check entitlement
  // itself here — this is not a duplicate of anything above for this branch.
  if (prisma) {
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.hasPrivateDelivery) {
      return json({ error: 'Private delivery is not available for this room' }, 403)
    }
  }

  const payload = privateDeliveryLocalUploadCompleteSchema.parse(body)
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

  if (fileResult.eventSlug !== event.slug) {
    return json({ error: 'Room slug mismatch' }, 400)
  }

  const asset = await repository.createPrivateAsset({
    eventId: event.id,
    originalName: fileResult.originalName,
    storedName: fileResult.storedName,
    mimeType: fileResult.mimeType,
    size: fileResult.size,
    url: fileResult.url,
    uploadedByRole: 'photographer',
    photographerLinkId: link.id,
  })

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED,
    { room_slug: event.slug, asset_id: asset.id, file_size: fileResult.size },
    { distinctId: `room:${event.slug}`, personProfile: false }
  )

  return json({ asset }, 201)
}

const listPhotographerAssets = async (request, token) => {
  const resolved = await getPhotographerLinkFromToken(token)
  if (!resolved) {
    return json({ error: 'Invalid or expired link' }, 403)
  }
  const { link } = resolved

  const repository = await getGalleryRepository()
  const assets = await repository.listPrivateAssetsByPhotographerLinkId(link.id)
  return json({ assets })
}

const getAdminConfig = async () => {
  const adminStatus = await getAdminAuthStatus()
  return jsonPrivate(adminStatus)
}

const getAdminSession = async (request) => {
  const adminStatus = await getAdminAuthStatus()
  const authenticated = await getAdminAuthentication(request)

  return jsonPrivate({
    ...adminStatus,
    authenticated,
  })
}

const setupAdmin = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`admin-setup:ip:${clientIp}`, ADMIN_LIMITS.login.ip.max, ADMIN_LIMITS.login.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited) {
    const response = jsonPrivate({ error: 'Too many attempts. Please try again later.', code: 'rate_limited', retryAfter: ipLimit.retryAfter }, 429)
    response.headers.set('Retry-After', String(ipLimit.retryAfter))
    return response
  }

  const payload = adminPasswordSchema.parse(await request.json())
  const adminStatus = await setupLocalAdminPassword(payload.password)
  const response = jsonPrivate({
    ...adminStatus,
    authenticated: true,
  }, 201)

  return setAdminSessionCookie(response)
}

const loginAdmin = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`admin-login:ip:${clientIp}`, ADMIN_LIMITS.login.ip.max, ADMIN_LIMITS.login.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited) {
    const response = jsonPrivate({ error: 'Too many attempts. Please try again later.', code: 'rate_limited', retryAfter: ipLimit.retryAfter }, 429)
    response.headers.set('Retry-After', String(ipLimit.retryAfter))
    return response
  }

  const payload = adminPasswordSchema.parse(await request.json())
  const isValid = await verifyAdminPassword(payload.password)

  if (!isValid) {
    return jsonPrivate({ error: 'Invalid admin password' }, 401)
  }

  const adminStatus = await getAdminAuthStatus()
  const response = jsonPrivate({
    ...adminStatus,
    authenticated: true,
  })

  return setAdminSessionCookie(response)
}

const logoutAdmin = async (request) => {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  const adminSession = token ? await verifyAdminSessionToken(token) : null
  const subject = `admin:${adminSession?.id || adminSession?.email || 'session'}`
  const csrf = requireCsrfProtection(request, subject)
  if (!csrf.success) {
    return jsonPrivate({ error: csrf.message, code: csrf.code }, csrf.status)
  }

  return clearAdminSessionCookie(jsonPrivate({ authenticated: false, loggedOut: true }))
}

const listAdminEvents = async (request) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  // listEvents() is also the direct PUBLIC handler for GET /events, so it
  // must stay on json(); strip the CORS headers back off here instead, now
  // that admin auth has already been verified.
  return stripPublicCorsHeaders(await listEvents())
}

const createAdminEvent = async (request) => {
  const authError = await requireAdminWithCsrf(request)
  if (authError) return authError

  const rateLimitCheck = await checkAdminRateLimit(request, ADMIN_LIMITS.write)
  if (rateLimitCheck) return rateLimitCheck

  // createEvent() is also the direct PUBLIC handler for POST /events (guest
  // room creation); see listAdminEvents above for why headers are stripped
  // here rather than changing the shared handler.
  return stripPublicCorsHeaders(await createEvent(request))
}

const getAdminEvent = async (request, slug) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  // getEvent() is also the direct PUBLIC handler for GET /events/:slug; see
  // listAdminEvents above for why headers are stripped here rather than
  // changing the shared handler.
  return stripPublicCorsHeaders(await getEvent(slug, { includeHidden: true }))
}

// Maps a PostHogQueryError category to a safe HTTP status. The upstream
// response body is never forwarded to the caller — only this fixed,
// pre-written message and status.
const POSTHOG_ERROR_STATUS = {
  [POSTHOG_ERROR.NOT_CONFIGURED]: 503,
  [POSTHOG_ERROR.TIMEOUT]: 504,
  [POSTHOG_ERROR.AUTH_FAILED]: 502,
  [POSTHOG_ERROR.RATE_LIMITED]: 429,
  [POSTHOG_ERROR.QUERY_FAILED]: 502,
  [POSTHOG_ERROR.INVALID_RESPONSE]: 502,
}

const getAdminTrafficMetrics = async (request) => {
  // Auth first, then validate input, then (only then) touch PostHog — an
  // unauthenticated/invalid request must never trigger an upstream query.
  const authError = await requireAdmin(request)
  if (authError) return authError

  const rateLimitCheck = await checkAdminRateLimit(request, ADMIN_LIMITS.read)
  if (rateLimitCheck) return rateLimitCheck

  const { searchParams } = new URL(request.url)
  const rangeResult = adminMetricsRangeSchema.safeParse(searchParams.get('range') || '30d')
  if (!rangeResult.success) {
    return jsonPrivate({ error: formatZodError(rangeResult.error) }, 400)
  }
  const range = rangeResult.data

  // 'all' is deferred for V1: there is no verified, trustworthy PostHog
  // project-start boundary to bound the query by, and deriving one via a
  // live MIN(timestamp) discovery query is left to a follow-up rather than
  // risking an unbounded historical scan. See admin-analytics-posthog.js.
  if (range === 'all') {
    return jsonPrivate({
      error: 'range_not_supported',
      message: 'range=all is deferred for V1. Use range=7d, 30d, or 90d.',
    }, 501)
  }

  try {
    const metrics = await getTrafficMetrics(range)
    return jsonPrivate({ range, source: 'posthog', ...metrics })
  } catch (error) {
    if (error instanceof PostHogQueryError) {
      const status = POSTHOG_ERROR_STATUS[error.category] || 502
      return jsonPrivate({ error: error.category, message: 'Analytics data is temporarily unavailable' }, status)
    }
    console.error('[admin/metrics/traffic] unexpected error:', error?.message)
    return jsonPrivate({ error: 'POSTHOG_QUERY_FAILED', message: 'Analytics data is temporarily unavailable' }, 502)
  }
}

const getAdminBusinessMetricsRoute = async (request) => {
  // Auth first, then validate input, then (only then) touch Postgres/PostHog
  // — mirrors getAdminTrafficMetrics above.
  const authError = await requireAdmin(request)
  if (authError) return authError

  const rateLimitCheck = await checkAdminRateLimit(request, ADMIN_LIMITS.read)
  if (rateLimitCheck) return rateLimitCheck

  const { searchParams } = new URL(request.url)
  const rangeResult = adminMetricsRangeSchema.safeParse(searchParams.get('range') || '30d')
  if (!rangeResult.success) {
    return jsonPrivate({ error: formatZodError(rangeResult.error) }, 400)
  }
  const range = rangeResult.data

  // 'all' is deferred, matching admin/metrics/traffic — see that handler's
  // comment for why.
  if (range === 'all') {
    return jsonPrivate({
      error: 'range_not_supported',
      message: 'range=all is deferred for V1. Use range=7d, 30d, or 90d.',
    }, 501)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'DATABASE_UNAVAILABLE', message: 'Business metrics are temporarily unavailable' }, 503)
  }

  try {
    const metrics = await getAdminBusinessMetrics({ prisma, range })
    return jsonPrivate(metrics)
  } catch (error) {
    console.error('[admin/metrics/business] unexpected error:', error?.message)
    return jsonPrivate({ error: 'BUSINESS_METRICS_QUERY_FAILED', message: 'Business metrics are temporarily unavailable' }, 502)
  }
}

const moderatePhoto = async (request, photoId) => {
  const authError = await requireAdminWithCsrf(request)
  if (authError) return authError

  const rateLimitCheck = await checkAdminRateLimit(request, ADMIN_LIMITS.write)
  if (rateLimitCheck) return rateLimitCheck

  const payload = adminModerationSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const photo = await repository.setPhotoStatus(photoId, payload.action === 'approve' ? 'VISIBLE' : 'HIDDEN')

  if (!photo) {
    return jsonPrivate({ error: 'Photo not found' }, 404)
  }

  // Keyed off the RESULTING authoritative status, so both branches are safe
  // to repeat on an idempotent re-moderation.
  //
  // HIDDEN: a photo deliberately withdrawn from public view must not keep
  // its public derivatives reachable. Deleting them does not revert
  // moderation if it fails.
  //
  // VISIBLE (STEP 7.15e): covers both HIDDEN→VISIBLE, where the previous
  // HIDDEN transition already deleted display-v1 and it needs regenerating
  // from the original source, and an idempotent VISIBLE→VISIBLE re-approve,
  // where this is a safe no-op repair (ensure-mode HITs cost one Blob head).
  // A generation failure never reverts the approval — see
  // ensurePhotoDisplayDerivative.
  if (photo.status === 'HIDDEN') {
    await deletePhotoDerivatives(photo.id, { context: 'moderatePhoto' })
  } else if (photo.status === 'VISIBLE') {
    await ensurePhotoDisplayDerivative(photo, { operation: 'moderatePhoto' })
  }

  console.log(`[audit] Admin ${payload.action}d photo ${photoId} in event ${photo.eventId}`)
  return jsonPrivate({ photo })
}

const deletePhoto = async (request, photoId) => {
  const authError = await requireAdminWithCsrf(request)
  if (authError) return authError

  const rateLimitCheck = await checkAdminRateLimit(request, ADMIN_LIMITS.write)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const photo = await repository.getPhotoById(photoId)

  if (!photo) {
    return jsonPrivate({ error: 'Photo not found' }, 404)
  }

  // Resolve event slug for audit log
  let eventSlug = ''
  try {
    const prisma = await getPrismaClient()
    if (prisma) {
      const event = await prisma.event.findUnique({ where: { id: photo.eventId }, select: { slug: true } })
      eventSlug = event?.slug || ''
    }
  } catch {
    eventSlug = ''
  }

  await repository.deletePhoto(photoId)

  // Graceful storage cleanup — do not fail if blob deletion errors
  try {
    await deleteEventScopedStoredFile({ url: photo.url, eventSlug, kind: 'room-photo', deleteFile: deleteStoredFile })
  } catch (storageError) {
    console.error('[deletePhoto] Storage cleanup failed for photo:', photoId, serializeProviderError('blob', 'delete_photo', storageError))
  }

  // Public derivative caches (wm-v1 / display-v1) are keyed by photo id and
  // are removed by nothing else. Best-effort by design: never throws, and a
  // cache failure must not change the delete contract. Residue is reclaimed
  // by the cleanup-photo-derivatives reconciliation cron.
  await deletePhotoDerivatives(photo.id, { context: 'deletePhoto' })

  // Audit log after successful deletion
  try {
    const prisma = await getPrismaClient()
    if (prisma) {
      await prisma.deletionLog.create({
        data: {
          photoId: photo.id,
          eventSlug,
          deletedBy: 'admin',
          reason: null,
        },
      })
    }
  } catch (logError) {
    console.error('[deletePhoto] Failed to write deletion log:', serializeProviderError('db', 'delete_photo_deletion_log', logError))
  }

  return jsonPrivate({ deleted: true, photo })
}

const getOwnerSession = async (request) => {
  const email = await getOwnerAuthentication(request)
  if (!email) {
    return jsonPrivate({ authenticated: false, email: null })
  }
  // Resolves the caller's own canonical Owner.id only — never another
  // Owner's — since `email` here is always the identity already verified
  // by getOwnerAuthentication() from this request's own session cookie.
  const owner = await resolveCanonicalOwner(email)
  return jsonPrivate({ authenticated: true, email, ownerId: owner?.id || null })
}

const loginOwner = withTiming('loginOwner', async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email) {
    return jsonPrivate({ error: 'Email is required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`session:ip:${clientIp}`, AUTH_LIMITS.session.ip.max, AUTH_LIMITS.session.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const emailLimit = await checkRateLimit(`session:email:${email}`, AUTH_LIMITS.session.email.max, AUTH_LIMITS.session.email.window)
  if (emailLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || emailLimit.limited) {
    return jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
  }

  // Password-based login takes priority
  if (password) {
    const { findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
    const owner = await findOwnerByEmailWithPassword(email, (candidate) =>
      verifyPassword(password, candidate.passwordSalt, candidate.passwordHash)
    )
    if (!owner) {
      return jsonPrivate({ error: 'Invalid email or password' }, 401)
    }
    const response = jsonPrivate({ authenticated: true, email })
    return await setOwnerSessionCookie(response, owner)
  }

  // Fallback to management token login (backward compatibility)
  if (!token) {
    return jsonPrivate({ error: 'Password or management token is required' }, 400)
  }

  const repository = await getGalleryRepository()
  const events = await repository.listEventsByOwnerEmail(email)

  let valid = false
  for (const event of events) {
    const fullEvent = await repository.getEventBySlug(event.slug)
    if (fullEvent && verifyManagementToken(token, fullEvent.managementTokenHash)) {
      valid = true
      break
    }
  }

  if (!valid) {
    return jsonPrivate({ error: 'Invalid email or management token' }, 401)
  }

  // Resolve the real Owner record so the session token carries the actual
  // sessionVersion instead of defaulting to 0 (see getOwnerEmailAndSessionVersion).
  // resolveCanonicalOwner returns null when Prisma is unavailable or when no
  // Owner row exists for this email — in either case we cannot issue a
  // session that will pass verifyOwnerSessionToken's DB check, so we must
  // not report authenticated:true or set a cookie.
  const owner = await resolveCanonicalOwner(email)

  if (!owner) {
    console.error('[api/owner/session] Unable to resolve owner after a valid management token')
    return jsonPrivate({ error: 'Login temporarily unavailable. Please try again shortly.' }, 503)
  }

  const response = jsonPrivate({ authenticated: true, email })
  return await setOwnerSessionCookie(response, owner)
})

const logoutOwner = async (request) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }
  const csrf = requireCsrfProtection(request, ownerEmail)
  if (!csrf.success) {
    return jsonPrivate({ error: csrf.message, code: csrf.code }, csrf.status)
  }
  return clearOwnerSessionCookie(jsonPrivate({ authenticated: false, loggedOut: true }))
}

const resendOwnerAccess = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  if (!resend) {
    return jsonPrivate({ error: 'Email service is not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonPrivate({ error: 'A valid email is required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`resend:ip:${clientIp}`, AUTH_LIMITS.resend.ip.max, AUTH_LIMITS.resend.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const emailLimit = await checkRateLimit(`resend:email:${email}`, AUTH_LIMITS.resend.email.max, AUTH_LIMITS.resend.email.window)
  if (emailLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || emailLimit.limited) {
    const retryAfter = Math.max(ipLimit.retryAfter || 0, emailLimit.retryAfter || 0)
    const response = jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
    if (retryAfter > 0) {
      response.headers.set('Retry-After', String(retryAfter))
    }
    return response
  }

  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    return jsonPrivate({ error: 'Email sender is not configured' }, 503)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
  }

  const owner = await prisma.owner.findUnique({ where: { email } })

  // Always return generic success — do not reveal whether email exists
  if (owner) {
    const appUrl = getAppUrl(request)
    if (!appUrl) {
      return jsonPrivate({ error: 'Service temporarily unavailable' }, 500)
    }
    const purpose = owner.passwordHash ? 'password_reset' : 'setup_password'
    try {
      const rawToken = await createPasswordResetTokenForOwner({ prisma, ownerId: owner.id, purpose, clientIp })
      const urlPath = purpose === 'password_reset' ? 'reset-password' : 'setup-password'
      const actionUrl = `${appUrl}/dashboard/${urlPath}?token=${encodeURIComponent(rawToken)}`
      const subject = purpose === 'password_reset' ? 'Reset your SnapRooms password' : 'Set your SnapRooms password'
      const actionText = purpose === 'password_reset' ? 'Reset your password' : 'Set your password'
      const expiryText = purpose === 'password_reset' ? '30 minutes' : '24 hours'

      const resendAccessEmail = buildEmail({
        subject,
        headline: subject,
        bodyLines: [
          `Tap the button below. This link is valid for ${expiryText}.`,
          `If you didn't request this, you can safely ignore this email.`,
        ],
        cta: { text: actionText, url: actionUrl },
        locale: 'en',
        appUrl,
      })
      const { error: resendAccessSendError } = await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject: resendAccessEmail.subject,
        text: resendAccessEmail.text,
        html: resendAccessEmail.html,
      })
      if (resendAccessSendError) {
        console.error('[resendOwnerAccess] Resend error:', serializeProviderError('resend', 'resend_owner_access', resendAccessSendError))
      }
    } catch (emailError) {
      console.error('[resendOwnerAccess] Failed to send email:', serializeProviderError('resend', 'resend_owner_access', emailError))
    }
  }

  return jsonPrivate({ success: true, message: 'If an account with this email exists, a password reset link has been sent.' })
}

const recoverOwnerAccess = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return jsonPrivate({ error: 'Recovery token required' }, 400)
  }

  const appUrl = getAppUrl(request)
  if (!appUrl) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 500)
  }
  const prisma = await getPrismaClient()

  // New DB-backed tokens: if the token is valid, redirect straight to the
  // password reset page.
  if (prisma) {
    const dbRecord = await findValidPasswordResetToken({
      prisma,
      rawToken: token,
      purpose: 'password_reset',
    })
    if (dbRecord) {
      const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(token)}`
      return NextResponse.redirect(new URL(resetUrl, request.url))
    }
  }

  // Legacy signed recovery tokens: verify, then mint a fresh single-use DB
  // token so old links remain usable until they expire.
  const email = await verifyRecoveryToken(token)
  if (!email) {
    return jsonPrivate({ error: 'Invalid or expired recovery link' }, 400)
  }

  if (prisma) {
    const owner = await prisma.owner.findUnique({ where: { email } })
    if (owner) {
      try {
        const rawToken = await createPasswordResetTokenForOwner({
          prisma,
          ownerId: owner.id,
          purpose: 'password_reset',
          clientIp: getClientIp(request),
        })
        const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(rawToken)}`
        return NextResponse.redirect(new URL(resetUrl, request.url))
      } catch (error) {
        console.error('[recoverOwnerAccess] Failed to mint DB token:', error)
      }
    }
  }

  // Fallback: redirect with the original token (will show an expired message).
  const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(token)}`
  return NextResponse.redirect(new URL(resetUrl, request.url))
}

const loginOwnerWithPassword = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return jsonPrivate({ error: 'Email and password are required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`login:ip:${clientIp}`, AUTH_LIMITS.login.ip.max, AUTH_LIMITS.login.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const emailLimit = await checkRateLimit(`login:email:${email}`, AUTH_LIMITS.login.email.max, AUTH_LIMITS.login.email.window)
  if (emailLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || emailLimit.limited) {
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'owner_login' }, { distinctId: 'rate_limit:owner_login', personProfile: false })
    return jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.error('[api/owner/login] Database unavailable')
    return jsonPrivate({ error: 'Login temporarily unavailable. Please try again shortly.' }, 503)
  }

  try {
    const { findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
    const owner = await findOwnerByEmailWithPassword(email, (candidate) =>
      verifyPassword(password, candidate.passwordSalt, candidate.passwordHash)
    )

    if (!owner) {
      return jsonPrivate({ error: 'Invalid email or password' }, 401)
    }

    trackServerEvent(EVENT_OWNER_LOGGED_IN, { method: 'password_api' }, { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true })

    const response = jsonPrivate({ authenticated: true, email, ownerId: owner.id })
    return await setOwnerSessionCookie(response, owner)
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      logDbError(error, '/api/owner/login', Date.now())
      return jsonPrivate({ error: getSafeDbErrorMessage(error, '/api/owner/login') }, 503)
    }
    console.error('[api/owner/login] Unexpected error:', error)
    await sendOpsAlert({
      severity: 'critical',
      type: 'auth:login:unexpected_error',
      title: 'Owner login failing with an unexpected error',
      message: error?.message,
      context: { errorCode: error?.code, errorName: error?.name },
    })
    return jsonPrivate({ error: 'Login temporarily unavailable. Please try again shortly.' }, 500)
  }
}

const forgotOwnerPassword = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonPrivate({ error: 'A valid email is required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`forgot:ip:${clientIp}`, AUTH_LIMITS.forgotPassword.ip.max, AUTH_LIMITS.forgotPassword.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const emailLimit = await checkRateLimit(`forgot:email:${email}`, AUTH_LIMITS.forgotPassword.email.max, AUTH_LIMITS.forgotPassword.email.window)
  if (emailLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || emailLimit.limited) {
    return jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
  }

  try {
    const prisma = await getPrismaClient()
    if (!prisma) {
      return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
    }

    const owner = await prisma.owner.findUnique({ where: { email } })

    if (owner && resend && process.env.RESEND_FROM_EMAIL) {
      try {
        const appUrl = getAppUrl(request)
        if (!appUrl) {
          return jsonPrivate({ error: 'Password reset is temporarily unavailable. Please try again later.' }, 500)
        }
        const purpose = owner.passwordHash ? 'password_reset' : 'setup_password'
        const rawToken = await createPasswordResetTokenForOwner({ prisma, ownerId: owner.id, purpose, clientIp })

        const urlPath = purpose === 'password_reset' ? 'reset-password' : 'setup-password'
        const actionUrl = `${appUrl}/dashboard/${urlPath}?token=${encodeURIComponent(rawToken)}`
        const subject = purpose === 'password_reset' ? 'Reset your SnapRooms password' : 'Set your SnapRooms password'
        const actionText = purpose === 'password_reset' ? 'Reset your password' : 'Set your password'
        const expiryText = purpose === 'password_reset' ? '30 minutes' : '24 hours'

        const forgotEmail = buildEmail({
          subject,
          headline: subject,
          bodyLines: [
            `Tap the button below. This link is valid for ${expiryText}.`,
            `If you did not request this, you can safely ignore this email.`,
          ],
          cta: { text: actionText, url: actionUrl },
          locale: 'en',
          appUrl,
        })
        const { error: forgotSendError } = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject: forgotEmail.subject,
          text: forgotEmail.text,
          html: forgotEmail.html,
        })
        if (forgotSendError) {
          console.error('[forgotOwnerPassword] Resend error:', serializeProviderError('resend', 'forgot_owner_password', forgotSendError))
        }
      } catch (emailError) {
        console.error('[forgotOwnerPassword] Failed to send email:', serializeProviderError('resend', 'forgot_owner_password', emailError))
      }
    }
  } catch (error) {
    console.error('[forgotOwnerPassword] Unexpected error:', serializeProviderError('db', 'forgot_owner_password', error))
    await sendOpsAlert({
      severity: 'critical',
      type: 'auth:forgot_password:unexpected_error',
      title: 'Password reset failing with an unexpected error',
      message: error?.message,
      context: { errorCode: error?.code, errorName: error?.name },
    })
    return jsonPrivate({ error: 'Password reset is temporarily unavailable. Please try again later.' }, 503)
  }

  // Anti-enumeration: return the same generic message regardless of whether
  // the email exists, the owner has a password, or email sending succeeded.
  return jsonPrivate({
    success: true,
    message: 'If an account with this email exists, a password reset link has been sent.',
  })
}

const resetOwnerPassword = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!token || !password) {
    return jsonPrivate({ error: 'Token and password are required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`reset:ip:${clientIp}`, AUTH_LIMITS.reset.ip.max, AUTH_LIMITS.reset.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const tokenLimit = await checkRateLimit(`reset:token:${hashPasswordResetToken(token)}`, 10, 15 * 60 * 1000)
  if (tokenLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || tokenLimit.limited) {
    return jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
  }

  const { valid, errors } = validatePassword(password)
  if (!valid) {
    return jsonPrivate({ error: `Password requirements: ${errors.join(', ')}` }, 400)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
  }

  const tokenRecord = await findValidPasswordResetToken({ prisma, rawToken: token, purpose: 'password_reset' })
  if (!tokenRecord) {
    return jsonPrivate({ error: 'Invalid or expired reset token' }, 400)
  }

  const { salt, hash } = await createPasswordHash(password)
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.ownerPasswordResetToken.findUnique({
        where: { id: tokenRecord.id },
      })
      if (!fresh || fresh.usedAt || fresh.expiresAt <= new Date()) {
        throw new Error('INVALID_TOKEN')
      }

      await tx.owner.update({
        where: { id: fresh.ownerId },
        data: {
          passwordHash: hash,
          passwordSalt: salt,
          passwordChangedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      })

      await tx.ownerPasswordResetToken.update({
        where: { id: fresh.id },
        data: { usedAt: new Date() },
      })

      await tx.ownerPasswordResetToken.updateMany({
        where: { ownerId: fresh.ownerId, usedAt: null, id: { not: fresh.id } },
        data: { usedAt: new Date() },
      })
    })
  } catch (error) {
    if (error.message === 'INVALID_TOKEN') {
      return jsonPrivate({ error: 'Invalid or expired reset token' }, 400)
    }
    console.error('[resetOwnerPassword] Transaction failed:', error)
    return jsonPrivate({ error: 'Unable to reset password. Please try again later.' }, 500)
  }

  const owner = await prisma.owner.findUnique({ where: { id: tokenRecord.ownerId } })
  const response = jsonPrivate({ authenticated: true, email: owner.email })
  return await setOwnerSessionCookie(response, owner)
}

const getSetupTokenStatus = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return jsonPrivate({ error: 'Setup token required' }, 400)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
  }

  const tokenRecord = await findValidPasswordResetToken({ prisma, rawToken: token, purpose: 'setup_password' })
  if (!tokenRecord || tokenRecord.owner.passwordHash) {
    return jsonPrivate({ error: 'Invalid or expired setup link' }, 400)
  }

  return jsonPrivate({ valid: true, email: tokenRecord.owner.email })
}

const getResetTokenStatus = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return jsonPrivate({ error: 'Reset token required' }, 400)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
  }

  const tokenRecord = await findValidPasswordResetToken({ prisma, rawToken: token, purpose: 'password_reset' })
  if (!tokenRecord) {
    return jsonPrivate({ error: 'Invalid or expired reset link' }, 400)
  }

  return jsonPrivate({ valid: true, email: tokenRecord.owner.email })
}

const setupOwnerPassword = async (request) => {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return jsonPrivate({ error: originCheck.message, code: originCheck.code }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!token || !password) {
    return jsonPrivate({ error: 'Token and password are required' }, 400)
  }

  const clientIp = getClientIp(request)
  const ipLimit = await checkRateLimit(`setup:ip:${clientIp}`, AUTH_LIMITS.setup.ip.max, AUTH_LIMITS.setup.ip.window)
  if (ipLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  const tokenLimit = await checkRateLimit(`setup:token:${hashPasswordResetToken(token)}`, 10, 15 * 60 * 1000)
  if (tokenLimit.backendError) {
    return buildRateLimitBackendErrorResponse()
  }
  if (ipLimit.limited || tokenLimit.limited) {
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'setup_password' }, { distinctId: 'rate_limit:setup_password', personProfile: false })
    return jsonPrivate({ error: 'Too many attempts. Please try again later.' }, 429)
  }

  const { valid, errors } = validatePassword(password)
  if (!valid) {
    return jsonPrivate({ error: `Password requirements: ${errors.join(', ')}` }, 400)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable' }, 503)
  }

  const tokenRecord = await findValidPasswordResetToken({ prisma, rawToken: token, purpose: 'setup_password' })
  if (!tokenRecord || tokenRecord.owner.passwordHash) {
    return jsonPrivate({ error: 'Invalid or expired setup token' }, 400)
  }

  const { salt, hash } = await createPasswordHash(password)
  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.ownerPasswordResetToken.findUnique({
        where: { id: tokenRecord.id },
      })
      if (!fresh || fresh.usedAt || fresh.expiresAt <= new Date()) {
        throw new Error('INVALID_TOKEN')
      }

      await tx.owner.update({
        where: { id: fresh.ownerId },
        data: {
          passwordHash: hash,
          passwordSalt: salt,
          passwordChangedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      })

      await tx.ownerPasswordResetToken.update({
        where: { id: fresh.id },
        data: { usedAt: new Date() },
      })

      await tx.ownerPasswordResetToken.updateMany({
        where: { ownerId: fresh.ownerId, usedAt: null, id: { not: fresh.id } },
        data: { usedAt: new Date() },
      })
    })
  } catch (error) {
    if (error.message === 'INVALID_TOKEN') {
      return jsonPrivate({ error: 'Invalid or expired setup token' }, 400)
    }
    console.error('[setupOwnerPassword] Transaction failed:', error)
    return jsonPrivate({ error: 'Unable to set password. Please try again later.' }, 500)
  }

  const owner = await prisma.owner.findUnique({ where: { id: tokenRecord.ownerId } })
  trackServerEvent(EVENT_OWNER_CLAIM_COMPLETED, {}, { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true })

  const response = jsonPrivate({ authenticated: true, email: owner.email })
  return await setOwnerSessionCookie(response, owner)
}

const listOwnerEvents = async (request) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const events = await repository.listEventsByOwnerEmail(ownerEmail)
  return jsonPrivate({ events: events.map(({ managementTokenHash, ...event }) => event) })
}

const getOwnerEvent = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  const now = new Date()
  const links = await repository.listPhotographerUploadLinks(event.id)
  const hasPhotographerUploadLink = links.some(
    (link) => !link.revokedAt && (!link.expiresAt || new Date(link.expiresAt) > now),
  )

  const { managementTokenHash, ...safeEvent } = event
  return jsonPrivate({ event: { ...safeEvent, hasPhotographerUploadLink } })
}

const getOwnerEventAnalytics = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable, please retry' }, 503)
  }

  const [views, uploads, uploadsByActorRaw, upsellByEventName] = await Promise.all([
    prisma.eventPageView.count({ where: { eventId: event.id } }),
    prisma.photo.count({ where: { eventId: event.id, status: 'VISIBLE' } }),
    prisma.photo.groupBy({
      by: ['uploadActorType'],
      where: { eventId: event.id, status: 'VISIBLE' },
      _count: { id: true },
    }),
    prisma.upsellEvent.groupBy({
      by: ['eventName'],
      where: { eventId: event.id },
      _count: { id: true },
    }),
  ])

  const uploadsByActor = uploadsByActorRaw.reduce((acc, row) => {
    acc[row.uploadActorType || 'unknown'] = row._count.id
    return acc
  }, {})

  const funnelCount = (eventName) => upsellByEventName.find((row) => row.eventName === eventName)?._count.id || 0

  return jsonPrivate({
    views,
    uploads,
    uploadsByActor,
    viewToUploadRate: views > 0 ? uploads / views : null,
    originalQualityUnlocked: Boolean(event.originalDownloadUnlocked),
    upsellFunnel: {
      impressions: funnelCount('upsell_impression'),
      clicks: funnelCount('upsell_click'),
      checkoutStarts: funnelCount('upsell_checkout_start'),
      conversions: funnelCount('upsell_conversion'),
    },
  })
}

const updateOwnerEvent = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.updateEvent)
  if (rateLimitCheck) return rateLimitCheck

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = updateEventSchema.parse(body)
  } catch (zodError) {
    return jsonPrivate({ error: formatZodError(zodError) }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  if (payload.coverUrl === null && event.coverUrl) {
    try {
      await deleteManagedEventCover(event.coverUrl, slug)
    } catch (storageError) {
      // event.coverUrl is a full Blob URL — never logged; slug identifies
      // the event just as well for on-call debugging.
      console.error('[updateOwnerEvent] Storage cleanup failed for cover:', slug, serializeProviderError('blob', 'update_owner_event_cover', storageError))
    }
  }

  const updatedEvent = await repository.updateEvent(slug, payload)
  return jsonPrivate({ event: updatedEvent })
}

const getOwnerNotificationPreferences = async (request) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const owner = await resolveCanonicalOwner(ownerEmail)
  if (!owner) {
    return jsonPrivate({ error: 'Owner not found' }, 404)
  }

  return jsonPrivate({ emailNotificationsEnabled: owner.emailNotificationsEnabled })
}

const updateOwnerNotificationPreferences = async (request) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.accountSettingsWrite)
  if (rateLimitCheck) return rateLimitCheck

  let body
  try {
    body = await request.json()
  } catch {
    return jsonPrivate({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body?.enabled !== 'boolean') {
    return jsonPrivate({ error: '"enabled" must be a boolean' }, 400)
  }

  const owner = await resolveCanonicalOwner(ownerEmail)
  if (!owner) {
    return jsonPrivate({ error: 'Owner not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return jsonPrivate({ error: 'Service temporarily unavailable, please retry' }, 503)
  }

  const updatedOwner = await prisma.owner.update({
    where: { id: owner.id },
    data: { emailNotificationsEnabled: body.enabled },
  })

  return jsonPrivate({ emailNotificationsEnabled: updatedOwner.emailNotificationsEnabled })
}

const deleteOwnerEvent = withTiming('deleteOwnerEvent', async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.deleteEvent)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return jsonPrivate({ error: 'Event not found' }, 404)
  }

  // See deleteEvent for the full rationale — same pre-commit/post-commit split.
  // listPrivateAssetsForEventDeletion (not listPrivateAssetsByEventId): the
  // latter degrades to [] when Prisma is unavailable, which here would be
  // indistinguishable from a genuinely empty event.
  const photoSourceUrls = await repository.listPhotoSourcesByEventId(event.id)
  const privateAssets = await repository.listPrivateAssetsForEventDeletion(event.id)

  let derivativePhotoIds = []
  try {
    derivativePhotoIds = await repository.listPhotoIdsByEventId(event.id)
  } catch (snapshotError) {
    console.error('[deleteOwnerEvent] Derivative id snapshot failed for event:', slug, snapshotError?.name)
  }

  await repository.deleteEvent(slug)

  await cleanupBlobsAfterEventDelete({
    eventId: event.id,
    eventSlug: slug,
    photoSourceUrls,
    privateAssets,
    coverUrl: event.coverUrl,
    derivativePhotoIds,
    operation: 'deleteOwnerEvent',
  })

  return jsonPrivate({ deleted: true })
})

const moderateOwnerPhoto = async (request, photoId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.deletePhoto)
  if (rateLimitCheck) return rateLimitCheck

  const payload = adminModerationSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const photo = await repository.setPhotoStatusByOwner(photoId, payload.action === 'approve' ? 'VISIBLE' : 'HIDDEN', ownerEmail)

  if (!photo) {
    return jsonPrivate({ error: 'Photo not found' }, 404)
  }

  // See moderatePhoto for the full rationale — same RESULTING-status split.
  if (photo.status === 'HIDDEN') {
    await deletePhotoDerivatives(photo.id, { context: 'moderateOwnerPhoto' })
  } else if (photo.status === 'VISIBLE') {
    await ensurePhotoDisplayDerivative(photo, { operation: 'moderateOwnerPhoto' })
  }

  console.log(`[audit] Owner ${hashIdentifier(ownerEmail)} ${payload.action}d photo ${photoId} in event ${photo.eventId}`)
  return jsonPrivate({ photo })
}

const deleteOwnerPhoto = async (request, photoId) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.deletePhoto)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const photo = await repository.deletePhotoByOwner(photoId, ownerEmail)

  if (!photo) {
    return jsonPrivate({ error: 'Photo not found' }, 404)
  }

  try {
    const ownerPhotoEvent = await repository.getEventById(photo.eventId)
    await deleteEventScopedStoredFile({ url: photo.url, eventSlug: ownerPhotoEvent?.slug || '', kind: 'room-photo', deleteFile: deleteStoredFile })
  } catch (storageError) {
    console.error('[deleteOwnerPhoto] Storage cleanup failed for photo:', photoId, serializeProviderError('blob', 'delete_owner_photo', storageError))
  }

  // Same shared helper as the admin path — derivative identity is never
  // reconstructed at a call site.
  await deletePhotoDerivatives(photo.id, { context: 'deleteOwnerPhoto' })

  console.log(`[audit] Owner ${hashIdentifier(ownerEmail)} deleted photo ${photoId} from event ${photo.eventId}`)
  return jsonPrivate({ deleted: true, photo })
}

export async function OPTIONS() {
  return json({ ok: true })
}

async function handleRoute(request, { params }) {
  const segments = getSegments(params)
  const method = request.method
  const route = `/${segments.join('/')}`
  const startTime = Date.now()

  try {
    if (segments.length === 0 && method === 'GET') {
      return routeRoot()
    }

    if (segments[0] === 'admin') {
      if (segments.length === 2 && segments[1] === 'config' && method === 'GET') {
        return getAdminConfig()
      }

      if (segments.length === 2 && segments[1] === 'session' && method === 'GET') {
        return getAdminSession(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'POST') {
        return setupAdmin(request)
      }

      if (segments.length === 2 && segments[1] === 'login' && method === 'POST') {
        return loginAdmin(request)
      }

      if (segments.length === 2 && segments[1] === 'logout' && method === 'POST') {
        return logoutAdmin(request)
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'GET') {
        return listAdminEvents(request)
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'POST') {
        return createAdminEvent(request)
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'GET') {
        return getAdminEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'PATCH') {
        return moderatePhoto(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'DELETE') {
        return deletePhoto(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'metrics' && segments[2] === 'traffic' && method === 'GET') {
        return getAdminTrafficMetrics(request)
      }

      if (segments.length === 3 && segments[1] === 'metrics' && segments[2] === 'business' && method === 'GET') {
        return getAdminBusinessMetricsRoute(request)
      }
    }

    if (segments[0] === 'owner') {
      if (segments.length === 2 && segments[1] === 'session' && method === 'GET') {
        return getOwnerSession(request)
      }

      if (segments.length === 2 && segments[1] === 'session' && method === 'POST') {
        return loginOwner(request)
      }

      if (segments.length === 2 && segments[1] === 'login' && method === 'POST') {
        return loginOwnerWithPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'logout' && method === 'POST') {
        return logoutOwner(request)
      }

      if (segments.length === 2 && segments[1] === 'resend' && method === 'POST') {
        return resendOwnerAccess(request)
      }

      if (segments.length === 2 && segments[1] === 'recover' && method === 'GET') {
        return recoverOwnerAccess(request)
      }

      if (segments.length === 2 && segments[1] === 'forgot-password' && method === 'POST') {
        return forgotOwnerPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'reset-password' && method === 'GET') {
        return getResetTokenStatus(request)
      }

      if (segments.length === 2 && segments[1] === 'reset-password' && method === 'POST') {
        return resetOwnerPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'GET') {
        return getSetupTokenStatus(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'POST') {
        return setupOwnerPassword(request)
      }

      if (segments.length === 3 && segments[1] === 'account' && segments[2] === 'notifications' && method === 'GET') {
        return getOwnerNotificationPreferences(request)
      }

      if (segments.length === 3 && segments[1] === 'account' && segments[2] === 'notifications' && method === 'PATCH') {
        return updateOwnerNotificationPreferences(request)
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'GET') {
        return listOwnerEvents(request)
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'GET') {
        return getOwnerEvent(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'analytics' && method === 'GET') {
        return getOwnerEventAnalytics(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'PATCH') {
        return updateOwnerEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'DELETE') {
        return deleteOwnerEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'PATCH') {
        return moderateOwnerPhoto(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'DELETE') {
        return deleteOwnerPhoto(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'private-delivery' && method === 'GET') {
        return listPrivateDeliveryAssets(request, segments[2])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'private-delivery' && segments[4] === 'init' && method === 'POST') {
        return initPrivateDeliveryUpload(request, segments[2])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'private-delivery' && segments[4] === 'blob' && method === 'POST') {
        return issuePrivateDeliveryBlobToken(request, segments[2])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'private-delivery' && segments[4] === 'complete' && method === 'POST') {
        return completePrivateDeliveryUpload(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'private-delivery' && method === 'DELETE') {
        return deletePrivateDeliveryAsset(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'photographer-links' && method === 'POST') {
        return createPhotographerUploadLink(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'photographer-links' && method === 'GET') {
        return listPhotographerUploadLinksHandler(request, segments[2])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'photographer-links' && method === 'DELETE') {
        return deletePhotographerUploadLink(request, segments[2], segments[4])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'cover' && method === 'POST') {
        return uploadEventCover(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'cover' && method === 'DELETE') {
        return deleteEventCover(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'moments' && method === 'GET') {
        return listOwnerEventMoments(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'moments' && method === 'POST') {
        return createOwnerEventMoment(request, segments[2])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'moments' && method === 'PATCH') {
        return updateOwnerEventMoment(request, segments[2], segments[4])
      }

      if (segments.length === 5 && segments[1] === 'events' && segments[3] === 'moments' && method === 'DELETE') {
        return deleteOwnerEventMoment(request, segments[2], segments[4])
      }
    }

    if (segments[0] === 'photographer-upload') {
      if (segments.length === 2 && method === 'GET') {
        return getPhotographerUploadEvent(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'init' && method === 'POST') {
        return initPhotographerUpload(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'blob' && method === 'POST') {
        return issuePhotographerBlobToken(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'complete' && method === 'POST') {
        return completePhotographerUpload(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'assets' && method === 'GET') {
        return listPhotographerAssets(request, segments[1])
      }
    }

    // NOTE: GET/POST /events, GET/PATCH/DELETE /events/:slug,
    // GET /events/:slug/photos, GET/POST /events/:slug/gallery-download,
    // POST /events/:slug/email, and POST /events/:slug/owner were extracted
    // to discrete handlers — see app/api/events/**/route.js. Next.js prefers
    // the static/dynamic route over this catch-all, so requests to those
    // paths never reach here; kept out of this dispatcher entirely.
    // listEvents/createEvent/getEvent/getAppUrl/cleanupBlobsAfterEventDelete
    // still live in lib/server/event-routes.js and are imported above
    // because the admin-session-wrapped endpoints below (and a few owner
    // endpoints) delegate to them directly.

    // NOTE: /uploads/init, /uploads/blob, /uploads/chunk, /uploads/complete
    // were extracted to discrete handlers — see app/api/uploads/*/route.js.
    // Next.js prefers the static route over this catch-all, so requests to
    // those paths never reach here; kept out of this dispatcher entirely.

    return json({ error: `Route /${segments.join('/')} not found` }, 404)
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      logDbError(error, route, startTime)
      return json({ error: getSafeDbErrorMessage(error, route) }, 503)
    }

    console.error('[API Route] Error:', error?.message || error)

    if (error?.issues) {
      return json({ error: formatZodError(error) }, 400)
    }

    return json({ error: 'Internal server error' }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PATCH = handleRoute
export const DELETE = handleRoute
