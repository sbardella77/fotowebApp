import { createHash, randomUUID } from 'crypto'
import { BlobError, head } from '@vercel/blob'
import { handleUpload } from '@vercel/blob/client'
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
import { Resend } from 'resend'
import {
  adminModerationSchema,
  adminPasswordSchema,
  blobUploadSessionCompleteSchema,
  createEventSchema,
  localUploadCompleteSchema,
  MAX_CHUNK_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES,
  privateDeliveryLocalUploadCompleteSchema,
  privateDeliveryUploadInitSchema,
  saveOwnerEmailSchema,
  slugify,
  updateEventSchema,
  uploadChunkSchema,
  uploadInitSchema,
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
import { getGalleryRepository, getGalleryRepositoryMode } from '@/lib/server/gallery-repository'
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
import { readSessionMeta, getReceivedChunkSize } from '@/lib/server/storage/local-storage'
import {
  createGalleryDownloadJob,
  getLatestGalleryDownloadJob,
  processGalleryDownloadJobIfPending,
} from '@/lib/server/gallery-download-job'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  EVENT_ROOM_CREATED,
  EVENT_OWNER_CLAIM_COMPLETED,
  EVENT_OWNER_LOGGED_IN,
  EVENT_RATE_LIMIT_HIT,
  EVENT_FREE_ROOM_LIMIT_HIT,
  EVENT_FREE_PHOTO_LIMIT_HIT,
  EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED,
  EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED,
  EVENT_PRIVATE_DELIVERY_DELETED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_REGENERATED,
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
  completeRoomPhotoBlobUpload,
} from '@/lib/server/blob-upload-completion'
import {
  BlobUploadTokenRequestError,
  createLazyServerBoundBlobUploadCallbacks,
  getBlobUploadRequestKind,
  parseCanonicalSessionPayload,
  validateBlobUploadCallbackUrl,
} from '@/lib/server/blob-upload-token'
import { getAdminAuthDriver, getDataAccessDriver, getPrismaClient } from '@/lib/server/prisma-client'
import {
  deleteStoredFile,
  getStoredNameFromBlobPathname,
  getStorageDriver,
  getStorageMode,
  isVercelBlobStorageConfigured,
  localStorageDriver,
} from '@/lib/server/storage'
import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'
import { deletePhotoDerivatives, deletePhotoDerivativesBatch } from '@/lib/server/derivative-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import {
  checkOwnerRoomCreationEntitlement,
  checkPrivateDeliveryEntitlement,
  checkRoomUploadEntitlement,
} from '@/lib/server/entitlements'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'
import {
  deleteManagedEventCover,
  getCoverStoragePath,
  optimizeCoverBuffer,
} from '@/lib/server/event-cover-storage'

export const runtime = 'nodejs'
// Event deletion can walk the authoritative (uncapped) source inventory
// sequentially — Production's largest observed event has 186 photos plus
// private assets and derivatives — so the default duration is too tight.
// 60s matches the ceiling already proven by app/api/download/gallery/route.js.
export const maxDuration = 60

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

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

const getPhotographerEventFromToken = async (token) => {
  if (!token) return null
  const prisma = await getPrismaClient()
  if (!prisma) return null
  const tokenHash = hashPhotographerUploadToken(token)
  const event = await prisma.event.findFirst({
    where: { photographerUploadTokenHash: tokenHash },
  })
  if (!event) return null
  if (event.photographerUploadTokenExpiresAt && new Date(event.photographerUploadTokenExpiresAt) < new Date()) {
    return null
  }
  return event
}

const routeRoot = async () => {
  const adminStatus = await getAdminAuthStatus()
  const repositoryMode = await getGalleryRepositoryMode()

  return json({
    name: 'Event Gallery MVP API',
    repositoryMode,
    configuredDataAccessDriver: getDataAccessDriver(),
    configuredAdminAuthDriver: getAdminAuthDriver(),
    storageMode: getStorageMode(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    adminConfigured: adminStatus.configured,
    adminSource: adminStatus.source,
  })
}

const createEvent = async (request) => {
  // Safe JSON parsing
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Manual validation before Zod to ensure clean error messages
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length < 3) {
    return json({ error: 'Event name must be at least 3 characters' }, 400)
  }

  // Now safe to use Zod for full validation
  let payload
  try {
    payload = createEventSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const clientIp = getClientIp(request)
  const createLimit = rateLimit(`create:ip:${clientIp}`, RATE_LIMITS.createEvent.ip.max, RATE_LIMITS.createEvent.ip.window)
  if (createLimit.limited) {
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'create_event', client_ip: clientIp }, { distinctId: clientIp })
    return json({ error: 'Too many rooms created. Please try again later.' }, 429)
  }

  const repository = await getGalleryRepository()

  let event = null
  let extraEventCreditConsumed = false

  // If owner email provided, enforce Free plan room limit before creating
  if (payload.ownerEmail) {
    const prisma = await getPrismaClient()
    const owner = await repository.getOrCreateOwnerByEmail(payload.ownerEmail)
    if (prisma && owner) {
      const entitlement = await checkOwnerRoomCreationEntitlement(prisma, owner)
      if (!entitlement.allowed) {
        trackServerEvent(
          EVENT_FREE_ROOM_LIMIT_HIT,
          {
            owner_id: owner.id,
            current_rooms: entitlement.current,
            limit: entitlement.max,
            extra_event_credits: entitlement.extraEventCredits,
          },
          { distinctId: payload.ownerEmail }
        )
        return json({
          error: `Free plan limit reached: you can only have ${entitlement.max} active room plus any Extra Free Events purchased.`,
          limit: 'room_count',
          current: entitlement.current,
          max: entitlement.max,
          extraEventCredits: entitlement.extraEventCredits,
          upgradePath: entitlement.upgradePath,
          oneTimePath: entitlement.oneTimePath,
        }, 403)
      }

      // If the owner is past the included free limit, consume an Extra Free Event credit atomically
      if (entitlement.consumeExtraCredit) {
        try {
          event = await prisma.$transaction(async (tx) => {
            await tx.owner.update({
              where: { id: owner.id, extraEventCredits: { gt: 0 } },
              data: { extraEventCredits: { decrement: 1 } },
            })
            return await repository.createEvent({ name: payload.name, prismaClient: tx })
          })
          extraEventCreditConsumed = true
        } catch (txError) {
          console.error('[api/events] Extra event credit transaction failed:', txError)
          return json({
            error: 'Extra Free Event credit no longer available. Please try again or upgrade to Professional.',
            limit: 'room_count',
            current: entitlement.current,
            max: entitlement.max,
            extraEventCredits: 0,
            upgradePath: 'professional',
            oneTimePath: 'extra_event',
          }, 403)
        }
      }
    }
  }

  if (!event) {
    event = await repository.createEvent({ name: payload.name })
  }

  trackServerEvent(
    EVENT_ROOM_CREATED,
    {
      room_slug: event.slug,
      has_owner_email: Boolean(payload.ownerEmail),
      extra_event_credit_used: extraEventCreditConsumed,
    },
    { distinctId: payload.ownerEmail || 'anonymous' }
  )

  // If owner email provided, immediately associate and send welcome email
  if (payload.ownerEmail) {
    const owner = await repository.getOrCreateOwnerByEmail(payload.ownerEmail)
    const managementToken = generateManagementToken()
    const managementTokenHash = hashManagementToken(managementToken)

    await repository.setEventOwnerEmail(event.slug, {
      ownerEmail: payload.ownerEmail,
      ownerId: owner?.id || null,
      managementTokenHash,
    })

    await sendOwnerNotificationEmail({ email: payload.ownerEmail, event, owner, request })
  }

  return json({ event }, 201)
}

const listEvents = async () => {
  const repository = await getGalleryRepository()
  const events = await repository.listEvents()
  return json({ events })
}

const getEvent = async (slug, options = {}) => {
  const start = Date.now()
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug, options)

  if (!event) {
    console.log(`[api/events/${slug}] 404 (took ${Date.now() - start}ms)`)
    return json({ error: 'Event not found' }, 404)
  }

  // Include owner plan so guests can see premium entitlement for Professional/Business accounts
  let ownerPlan = null
  try {
    const prisma = await getPrismaClient()
    if (prisma && event.ownerId) {
      const owner = await prisma.owner.findUnique({
        where: { id: event.ownerId },
        select: { plan: true },
      })
      if (owner) ownerPlan = owner.plan
    }
  } catch {
    // ignore, ownerPlan stays null
  }

  const duration = Date.now() - start
  console.log(`[api/events/${slug}] 200 (took ${duration}ms) photos=${event.photos?.length || 0} photoCount=${event.photoCount || 0}`)
  // Strip sensitive fields before exposing the event publicly.
  // ownerEmail is intentionally kept: the public room page (room-page-client.jsx)
  // uses it to recognize the logged-in owner viewing their own room.
  const {
    managementTokenHash,
    photographerUploadTokenHash,
    stripeCheckoutSessionId,
    originalDownloadCheckoutSessionId,
    ...publicEvent
  } = event
  return json({ event: { ...publicEvent, ownerPlan } })
}

const getEventPhotos = withTiming('getEventPhotos', async (request, slug) => {
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor') || undefined
  const take = Math.min(parseInt(searchParams.get('take') || '24', 10), 48)
  const sort = searchParams.get('sort') === 'oldest' ? 'oldest' : 'recent'
  const momentParam = searchParams.get('moment') || undefined
  const momentSlug = momentParam && momentParam !== 'all' ? momentParam : undefined

  const result = await repository.getEventPhotosPaginated({
    eventId: event.id,
    cursor,
    take,
    sort,
    momentSlug,
  })

  return json({
    photos: result.photos,
    nextCursor: result.nextCursor,
    total: result.total,
  })
})

const createGalleryDownload = withTiming('createGalleryDownload', async (request, slug) => {
  const clientIp = getClientIp(request)
  const rateLimitCheck = await checkRateLimit(
    `gallery-download:create:ip:${hashIdentifier(clientIp)}:event:${slug}`,
    RATE_LIMITS.galleryDownloadCreate.ip.max,
    RATE_LIMITS.galleryDownloadCreate.ip.window
  )
  if (rateLimitCheck.limited) return buildRateLimitResponse(rateLimitCheck)

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    return json({ error: 'Database unavailable' }, 503)
  }

  const access = await getEffectiveEventAccessState(prisma, event)
  if (!access.canDownloadGallery) {
    return json({ error: 'Gallery download is not available for this event' }, 403)
  }

  const job = await createGalleryDownloadJob(event.id)
  return json({ job })
})

const getGalleryDownload = withTiming('getGalleryDownload', async (request, slug) => {
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const job = await getLatestGalleryDownloadJob(event.id)
  if (!job) {
    return json({ job: null })
  }

  if (job.status === 'PENDING') {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000
    const processedRecently = job.processedAt && job.processedAt.getTime() > twoMinutesAgo
    if (!processedRecently) {
      try {
        await processGalleryDownloadJobIfPending(job.id, event)
        const refreshed = await getLatestGalleryDownloadJob(event.id)
        return json({ job: refreshed })
      } catch (processingError) {
        console.error('[getGalleryDownload] processing failed:', processingError)
        const refreshed = await getLatestGalleryDownloadJob(event.id)
        return json({ job: refreshed })
      }
    }
  }

  return json({ job })
})

const getAppUrl = (request) => {
  const envUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (envUrl) return envUrl.replace(/\/$/, '')

  console.error('[getAppUrl] APP_URL/NEXT_PUBLIC_APP_URL not configured; refusing to build URLs from the Host header')
  return null
}

const saveEventByEmail = async (request, slug) => {
  if (!resend) {
    return json({ error: 'Email service is not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  const clientIp = getClientIp(request)
  const emailLimit = rateLimit(`send-event-email:ip:${clientIp}`, RATE_LIMITS.sendEventEmail.ip.max, RATE_LIMITS.sendEventEmail.ip.window)
  if (emailLimit.limited) {
    return json({ error: 'Too many emails sent. Please try again later.' }, 429)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    return json({ error: 'Email sender is not configured' }, 503)
  }

  const appUrl = getAppUrl(request)
  if (!appUrl) {
    return json({ error: 'Unable to send email. Please try again later.' }, 500)
  }
  const eventUrl = `${appUrl}/event/${event.slug}`

  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: email,
      reply_to: 'hello@snaprooms.app',
      subject: `Your SnapRooms room is ready`,
      text: `Hi,

Your SnapRooms room "${event.name}" is ready.

Open your room here:
${eventUrl}

Share this link with your guests so they can upload their photos.

If you didn't request this email, you can ignore it.

– SnapRooms
Every guest photo. One room.`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Your room is ready</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is ready.<br />
    Share the link below with your guests so they can upload their photos.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${eventUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open your room</a>
  </p>
  <div style="margin:0 0 24px;padding:16px;background:#F7F7F8;border:1px solid #E5E7EB;border-radius:8px;text-align:center;">
    <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;">Room link</p>
    <p style="margin:0;font-size:14px;word-break:break-all;color:#374151;">${eventUrl}</p>
  </div>
  <p style="margin:0 0 32px;text-align:center;color:#6b7280;font-size:14px;">
    If you didn't request this email, you can ignore it.
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
    })

    if (sendError) {
      console.error('[saveEventByEmail] Resend error:', sendError)
      return json({ error: sendError.message || 'Unable to send email' }, 502)
    }

    return json({ success: true, id: data?.id })
  } catch (error) {
    console.error('[saveEventByEmail] Unexpected error:', error)
    return json({ error: error?.message || 'Unable to send email' }, 502)
  }
}

const getManagementTokenFromRequest = (request) => {
  const auth = request.headers.get('authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

const sendOwnerNotificationEmail = async ({ email, event, owner, request }) => {
  if (!resend) return
  const from = process.env.RESEND_FROM_EMAIL
  if (!from) return

  const prisma = await getPrismaClient()
  if (!prisma || !owner?.id) return

  const appUrl = getAppUrl(request)
  if (!appUrl) return
  const clientIp = getClientIp(request)
  try {
    const isFirstTime = !owner?.passwordHash
    if (isFirstTime) {
      const setupToken = await createPasswordResetTokenForOwner({
        prisma,
        ownerId: owner.id,
        purpose: 'setup_password',
        clientIp,
      })
      const setupUrl = `${appUrl}/dashboard/setup-password?token=${encodeURIComponent(setupToken)}`
      await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject: `Set your SnapRooms password`,
        text: `Hi,

Your room "${event.name}" is ready.

To manage your rooms securely, set your password here:
${setupUrl}

This link expires in 24 hours.

SnapRooms — Every guest photo. One room.`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Set your password</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is ready. Create a password to manage all your rooms in one place.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${setupUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Set password</a>
  </p>
  <p style="margin:0 0 32px;text-align:center;color:#6b7280;font-size:14px;">
    This link expires in 24 hours. If you didn't create this room, you can safely ignore this email.
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
      })
    } else {
      const dashboardUrl = `${appUrl}/dashboard`
      await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject: `Your SnapRooms room "${event.name}"`,
        text: `Hi,

Your room "${event.name}" has been added to your dashboard.

Open your dashboard:
${dashboardUrl}

SnapRooms — Every guest photo. One room.`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Room added to your dashboard</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is now in your dashboard.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open dashboard</a>
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
      })
    }
  } catch (emailError) {
    console.error('[sendOwnerNotificationEmail] Failed to send owner email:', emailError)
  }
}

const saveEventOwner = async (request, slug) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = saveOwnerEmailSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const token = getManagementTokenFromRequest(request)

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  // If the event already has a management token, require it to change ownership.
  // This prevents unauthorized takeover of existing rooms.
  if (event.managementTokenHash && !verifyManagementToken(token, event.managementTokenHash)) {
    return json({ error: 'Management token required to change room ownership' }, 403)
  }

  const owner = await repository.getOrCreateOwnerByEmail(payload.email)

  // Enforce Free plan room limit when claiming a new room
  const prisma = await getPrismaClient()
  if (prisma && owner) {
    const isAlreadyOwner =
      event.ownerId === owner.id ||
      event.ownerEmail?.toLowerCase() === payload.email.toLowerCase()
    if (!isAlreadyOwner) {
      const entitlement = await checkOwnerRoomCreationEntitlement(prisma, owner)
      if (!entitlement.allowed) {
        trackServerEvent(
          EVENT_FREE_ROOM_LIMIT_HIT,
          {
            owner_id: owner.id,
            current_rooms: entitlement.current,
            limit: entitlement.max,
          },
          { distinctId: payload.email }
        )
        return json({
          error: `Free plan limit reached: you can only have ${entitlement.max} active room.`,
          limit: 'room_count',
          current: entitlement.current,
          max: entitlement.max,
          upgradePath: entitlement.upgradePath,
        }, 403)
      }
    }
  }

  const managementToken = generateManagementToken()
  const managementTokenHash = hashManagementToken(managementToken)

  const updatedEvent = await repository.setEventOwnerEmail(slug, {
    ownerEmail: payload.email,
    ownerId: owner?.id || null,
    managementTokenHash,
  })

  await sendOwnerNotificationEmail({ email: payload.email, event, owner, request })

  return json({ event: updatedEvent, managementToken })
}

const updateEvent = async (request, slug) => {
  const clientIp = getClientIp(request)
  const rateLimitCheck = await checkRateLimit(
    `public-event-update:ip:${hashIdentifier(clientIp)}:event:${slug}`,
    RATE_LIMITS.publicEventUpdate.ip.max,
    RATE_LIMITS.publicEventUpdate.ip.window
  )
  if (rateLimitCheck.limited) return buildRateLimitResponse(rateLimitCheck)

  const token = getManagementTokenFromRequest(request)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = updateEventSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  if (!verifyManagementToken(token, event.managementTokenHash)) {
    return json({ error: 'Management token required' }, 403)
  }

  const updatedEvent = await repository.updateEvent(slug, payload)
  console.log(`[audit] Management-token update of event ${slug} to "${payload.name}"`)
  return json({ event: updatedEvent })
}

/**
 * Best-effort destructive cleanup for an Event that has ALREADY been deleted
 * (STEP 7.15d.3). Callers must invoke this only after `repository.deleteEvent`
 * has resolved successfully, and must pass inventories captured BEFORE that
 * call — the rows this reads from no longer exist by the time this runs.
 *
 * Nothing here may turn a successful Event deletion into an HTTP failure:
 * the DB row is already gone, so a 500 would invite a retry that can never
 * reproduce the same operation. Failures/skips are counted and surfaced as
 * at most one aggregate ops alert instead of failing the response.
 *
 * @param {object} params
 * @param {string} params.eventId              opaque id — safe to log/alert
 * @param {string} params.eventSlug            authoritative slug for the event-scoped guard
 * @param {string[]} params.photoSourceUrls    pre-commit HARD-REQUIRED source snapshot
 * @param {Array<{url: string}>} params.privateAssets  pre-commit HARD-REQUIRED snapshot
 * @param {string|null} [params.coverUrl]      pre-commit Event.coverUrl value
 * @param {string[]} params.derivativePhotoIds pre-commit BEST-EFFORT derivative snapshot
 * @param {string} params.operation            log/alert context label
 */
async function cleanupBlobsAfterEventDelete({
  eventId,
  eventSlug,
  photoSourceUrls,
  privateAssets,
  coverUrl,
  derivativePhotoIds,
  operation,
}) {
  let photoFailureCount = 0
  let photoSkippedCount = 0
  for (const url of photoSourceUrls) {
    try {
      const result = await deleteEventScopedStoredFile({
        url,
        eventSlug,
        kind: 'room-photo',
        deleteFile: deleteStoredFile,
      })
      if (result.skipped) photoSkippedCount += 1
    } catch (storageError) {
      photoFailureCount += 1
      console.error(`[${operation}] Post-delete photo source cleanup failed:`, storageError?.name)
    }
  }

  let coverFailure = false
  if (coverUrl) {
    try {
      const cleaned = await deleteManagedEventCover(coverUrl, eventSlug)
      if (!cleaned) coverFailure = true
    } catch (storageError) {
      coverFailure = true
      console.error(`[${operation}] Post-delete cover cleanup failed:`, storageError?.name)
    }
  }

  let privateAssetFailureCount = 0
  let privateAssetSkippedCount = 0
  for (const asset of privateAssets) {
    try {
      const result = await deleteEventScopedStoredFile({
        url: asset.url,
        eventSlug,
        kind: 'private-asset',
        deleteFile: deleteStoredFile,
      })
      if (result.skipped) privateAssetSkippedCount += 1
    } catch (storageError) {
      privateAssetFailureCount += 1
      console.error(`[${operation}] Post-delete private asset cleanup failed:`, storageError?.name)
    }
  }

  // Derivatives are reproducible caches with a reconciliation cron behind
  // them (lib/server/derivative-cleanup.js), so this stays best-effort and
  // never throws — its own failures are not folded into the alert below.
  await deletePhotoDerivativesBatch(derivativePhotoIds, { context: operation })

  const hasPartialFailure =
    photoFailureCount > 0 ||
    photoSkippedCount > 0 ||
    privateAssetFailureCount > 0 ||
    privateAssetSkippedCount > 0 ||
    coverFailure

  if (hasPartialFailure) {
    // sendOpsAlert never throws. Its context is forwarded close to verbatim
    // (only key-name filtering) to the alert recipient — never pass a URL,
    // slug or filename here.
    await sendOpsAlert({
      severity: 'warning',
      type: 'ops:event:source_cleanup_partial_failure',
      title: 'Event deletion: source cleanup partially failed',
      message:
        'The event was deleted successfully, but one or more of its source, cover, or private-asset storage objects could not be cleaned up.',
      context: {
        eventId,
        operation,
        photoCandidateCount: photoSourceUrls.length,
        photoSkippedCount,
        photoFailureCount,
        privateAssetCandidateCount: privateAssets.length,
        privateAssetSkippedCount,
        privateAssetFailureCount,
        coverFailure,
      },
    })
  }
}

const deleteEvent = withTiming('deleteEvent', async (request, slug) => {
  const clientIp = getClientIp(request)
  const rateLimitCheck = await checkRateLimit(
    `public-event-delete:ip:${hashIdentifier(clientIp)}:event:${slug}`,
    RATE_LIMITS.publicEventDelete.ip.max,
    RATE_LIMITS.publicEventDelete.ip.window
  )
  if (rateLimitCheck.limited) return buildRateLimitResponse(rateLimitCheck)

  const token = getManagementTokenFromRequest(request)

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug, { includeHidden: true })

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  if (!verifyManagementToken(token, event.managementTokenHash)) {
    return json({ error: 'Management token required' }, 403)
  }

  // ── PRE-COMMIT snapshots only (STEP 7.15d.3). Zero destructive Blob IO may
  // occur below this point until the DB delete gate resolves successfully. ──

  // HARD REQUIRED — the authoritative, uncapped source inventory. `event.photos`
  // is a presentation list capped at 100 and Production already holds a
  // 186-photo event, so using it here would silently strand every original
  // past the cap. Deliberately unwrapped: a failure here must abort BEFORE
  // the Event row is destroyed, so it propagates to the route's top-level
  // error handler and `repository.deleteEvent` is never reached.
  const photoSourceUrls = await repository.listPhotoSourcesByEventId(event.id)

  // HARD REQUIRED for the same reason — once the Event cascades away there is
  // no way to rediscover which PrivateAsset rows belonged to it.
  const privateAssets = await repository.listPrivateAssetsByEventId(event.id)

  // BEST EFFORT — derivatives are reproducible caches with a reconciliation
  // cron behind them, so losing this snapshot must not block deletion.
  let derivativePhotoIds = []
  try {
    derivativePhotoIds = await repository.listPhotoIdsByEventId(event.id)
  } catch (snapshotError) {
    console.error('[deleteEvent] Derivative id snapshot failed for event:', slug, snapshotError?.name)
  }

  // ── THE COMMIT GATE. Nothing above this line can delete a Blob; nothing
  // below runs unless the Event row is provably gone. ────────────────────
  await repository.deleteEvent(slug)

  await cleanupBlobsAfterEventDelete({
    eventId: event.id,
    eventSlug: slug,
    photoSourceUrls,
    privateAssets,
    coverUrl: event.coverUrl,
    derivativePhotoIds,
    operation: 'deleteEvent',
  })

  console.log(`[audit] Management-token deletion of event ${slug} with ${photoSourceUrls.length} photo sources and ${privateAssets.length} private assets`)
  return json({ deleted: true })
})

const initUpload = async (request) => {
  // Broad, Redis-backed, hashed-IP guard — the only thing that runs before
  // any database access, bounding gross pre-DB exposure from a single IP.
  // Guest-exclusive route: distinct from the shared blob-token-broad guard.
  const clientIp = getClientIp(request)
  const broadInitLimit = await checkRateLimit(
    `guest-init-broad:ip:${hashIdentifier(clientIp)}`,
    RATE_LIMITS.guestInitBroad.ip.max,
    RATE_LIMITS.guestInitBroad.ip.window,
  )
  if (broadInitLimit.limited) {
    return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
  }

  const payload = uploadInitSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(payload.eventSlug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  // eventId-scoped primary product-level throttle — runs only once the
  // Event has been resolved, before entitlement checks or session creation.
  const initEventLimit = await checkRateLimit(
    `guest-init-event:${event.id}`,
    RATE_LIMITS.guestInitEvent.event.max,
    RATE_LIMITS.guestInitEvent.event.window,
  )
  if (initEventLimit.limited) {
    return json({ error: 'Too many upload attempts. Please try again later.' }, 429)
  }

  // Enforce photo limit for Free rooms
  const prisma = await getPrismaClient()
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
        { distinctId: event.slug }
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

  const storageDriver = getStorageDriver()

  if (storageDriver.mode === 'vercel-blob') {
    if (!prisma) {
      return json(
        { error: 'Database is required for secure Blob uploads' },
        503,
      )
    }

    const session = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver,
      event,
      payload,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      uploaderName: payload.uploaderName,
      caption: payload.caption,
      momentId: payload.momentId,
    })

    return json({ session }, 201)
  }

  const session = await storageDriver.initUploadSession(payload)
  return json({ session }, 201)
}

const issueBlobUploadToken = async (request) => {
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

const uploadChunk = async (request) => {
  const clientIp = getClientIp(request)
  const limit = rateLimit(`upload-chunk:ip:${clientIp}`, RATE_LIMITS.uploadChunk.ip.max, RATE_LIMITS.uploadChunk.ip.window)
  if (limit.limited) {
    return json({ error: 'Too many upload chunks. Please try again later.' }, 429)
  }

  const formData = await request.formData()
  const chunk = formData.get('chunk')
  const parsed = uploadChunkSchema.parse({
    sessionId: String(formData.get('sessionId') || ''),
    chunkIndex: Number(formData.get('chunkIndex')),
    totalChunks: Number(formData.get('totalChunks')),
  })

  if (!(chunk instanceof File)) {
    return json({ error: 'chunk file is required' }, 400)
  }

  const chunkBuffer = Buffer.from(await chunk.arrayBuffer())

  if (chunkBuffer.byteLength > MAX_CHUNK_SIZE_BYTES) {
    return json({ error: 'Chunk exceeds server limit' }, 400)
  }

  // Validate session exists and enforce cumulative size limit
  let meta
  try {
    meta = await readSessionMeta(parsed.sessionId)
  } catch {
    return json({ error: 'Upload session not found or expired' }, 400)
  }

  const receivedSoFar = await getReceivedChunkSize(parsed.sessionId)
  if (receivedSoFar + chunkBuffer.length > meta.fileSize) {
    return json({ error: 'Cumulative chunk size exceeds declared file size' }, 413)
  }

  await localStorageDriver.saveChunk({
    sessionId: parsed.sessionId,
    chunkIndex: parsed.chunkIndex,
    chunkBuffer,
  })

  return json({ uploaded: true, chunkIndex: parsed.chunkIndex, totalChunks: parsed.totalChunks })
}

const completeUpload = withTiming('completeUpload', async (request) => {
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
            { distinctId: error.details.eventSlug },
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

    const repository = await getGalleryRepository()
    const freshEvent = await repository.getEventBySlug(result.eventSlug)

    return json(
      {
        photo: result.photo,
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
  const fileResult = await localStorageDriver.completeUploadSession({
    sessionId: payload.sessionId,
    photoId: randomUUID(),
  })

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
        { distinctId: event.slug }
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

  const photo = await repository.createPhoto({
    eventId: event.id,
    originalName: fileResult.originalName,
    storedName: fileResult.storedName,
    mimeType: fileResult.mimeType,
    size: fileResult.size,
    url: fileResult.url,
    uploaderName: payload.uploaderName,
    caption: payload.caption,
    momentId: payload.momentId || undefined,
  })

  const freshEvent = await repository.getEventBySlug(event.slug)

  return json({
    photo,
    event: freshEvent,
  }, 201)
})

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
    { room_slug: slug, file_name: payload.fileName, file_size: payload.fileSize },
    { distinctId: ownerEmail }
  )

  return jsonPrivate({ session }, 201)
}

const issuePrivateDeliveryBlobToken = async (request) => {
  return issueBlobUploadToken(request)
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
        { distinctId: ownerEmail }
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
  const fileResult = await localStorageDriver.completeUploadSession({
    sessionId: payload.sessionId,
    photoId: randomUUID(),
  })

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
    { distinctId: ownerEmail }
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
    console.error('[deletePrivateDeliveryAsset] Storage cleanup failed:', assetId, storageError)
  }

  await repository.deletePrivateAssetById(assetId)

  trackServerEvent(
    EVENT_PRIVATE_DELIVERY_DELETED,
    { room_slug: event.slug, asset_id: assetId },
    { distinctId: ownerEmail }
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

  const token = generatePhotographerUploadToken()
  const tokenHash = hashPhotographerUploadToken(token)
  const isRegeneration = Boolean(event.photographerUploadTokenHash)

  await repository.setPhotographerUploadToken(slug, { tokenHash })

  trackServerEvent(
    isRegeneration ? EVENT_PHOTOGRAPHER_UPLOAD_LINK_REGENERATED : EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
    { room_slug: slug },
    { distinctId: ownerEmail }
  )

  const appUrl = getAppUrl(request)
  if (!appUrl) {
    return jsonPrivate({ error: 'Unable to create upload link. Please try again later.' }, 500)
  }
  return jsonPrivate({ token, url: `${appUrl}/photographer-upload/${token}` })
}

const deletePhotographerUploadLink = async (request, slug) => {
  const ownerEmail = await requireOwnerWithCsrf(request)
  if (typeof ownerEmail !== 'string') return ownerEmail

  const rateLimitCheck = await checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.photographerLinkWrite)
  if (rateLimitCheck) return rateLimitCheck

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)
  if (!event) {
    return jsonPrivate({ error: 'Room not found' }, 404)
  }

  await repository.setPhotographerUploadToken(slug, { tokenHash: null, expiresAt: null })

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED,
    { room_slug: slug },
    { distinctId: ownerEmail }
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

  const clientIp = getClientIp(request)
  const ipLimit = rateLimit(`cover-upload:ip:${clientIp}`, RATE_LIMITS.coverUpload.ip.max, RATE_LIMITS.coverUpload.ip.window)
  if (ipLimit.limited) {
    return jsonPrivate({ error: 'Too many cover uploads. Please try again later.' }, 429)
  }
  const ownerLimit = rateLimit(`cover-upload:owner:${ownerEmail}`, RATE_LIMITS.coverUpload.owner.max, RATE_LIMITS.coverUpload.owner.window)
  if (ownerLimit.limited) {
    return jsonPrivate({ error: 'Too many cover uploads for this account. Please try again later.' }, 429)
  }

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
    console.error('[uploadEventCover] Storage error:', storageError)
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
      console.error('[deleteEventCover] Storage cleanup failed for cover:', event.coverUrl, storageError)
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
  const event = await getPhotographerEventFromToken(token)
  if (!event) {
    return json({ error: 'Invalid or expired link' }, 403)
  }

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
  // getPhotographerEventFromToken() validates it below (a DB lookup) — so
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

  const event = await getPhotographerEventFromToken(token)
  if (!event) {
    return json({ error: 'Invalid or expired link' }, 403)
  }

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
    { room_slug: event.slug, file_name: payload.fileName, file_size: payload.fileSize },
    { distinctId: `photographer_${event.slug}` }
  )

  return json({ session }, 201)
}

const issuePhotographerBlobToken = async (request) => {
  return issueBlobUploadToken(request)
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

  const event = await getPhotographerEventFromToken(token)
  if (!event) {
    return json({ error: 'Invalid or expired link' }, 403)
  }

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
        { distinctId: `photographer_${event.slug}` }
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
  const fileResult = await localStorageDriver.completeUploadSession({
    sessionId: payload.sessionId,
    photoId: randomUUID(),
  })

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
  })

  trackServerEvent(
    EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED,
    { room_slug: event.slug, asset_id: asset.id, file_size: fileResult.size },
    { distinctId: `photographer_${event.slug}` }
  )

  return json({ asset }, 201)
}

const listPhotographerAssets = async (request, token) => {
  const event = await getPhotographerEventFromToken(token)
  if (!event) {
    return json({ error: 'Invalid or expired link' }, 403)
  }

  const repository = await getGalleryRepository()
  const assets = await repository.listPrivateAssetsByEventIdAndRole(event.id, 'photographer')
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

  // A HIDDEN photo has been deliberately withdrawn from public view, so its
  // public derivatives must not stay reachable. Keyed off the RESULTING
  // authoritative status, which makes an idempotent re-hide safe to repeat.
  // Deleting them does not revert moderation if it fails, and HIDDEN→VISIBLE
  // deliberately regenerates nothing here (see DISPLAY_REGEN_ON_VISIBLE_TRANSITION).
  if (photo.status === 'HIDDEN') {
    await deletePhotoDerivatives(photo.id, { context: 'moderatePhoto' })
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
    console.error('[deletePhoto] Storage cleanup failed for photo:', photoId, storageError)
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
    console.error('[deletePhoto] Failed to write deletion log:', logError)
  }

  return jsonPrivate({ deleted: true, photo })
}

const getOwnerSession = async (request) => {
  const email = await getOwnerAuthentication(request)
  return jsonPrivate({ authenticated: Boolean(email), email })
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

      await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject,
        text: `Hi,

You requested to ${purpose === 'password_reset' ? 'reset your SnapRooms password' : 'access your SnapRooms dashboard'}.

${actionText} here:
${actionUrl}

This link expires in ${expiryText}. If you didn't request this, you can safely ignore this email.

– SnapRooms
Every guest photo. One room.`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;"><span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span></div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">${subject}</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">Tap the button below. This link is valid for ${expiryText}.</p>
  <p style="margin:0 0 24px;text-align:center;"><a href="${actionUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${actionText}</a></p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">If you didn't request this, you can safely ignore this email.<br>SnapRooms — Every guest photo. One room.</p>
</div>`,
      })
    } catch (emailError) {
      console.error('[resendOwnerAccess] Failed to send email:', emailError)
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
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'owner_login', client_ip: clientIp }, { distinctId: clientIp })
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

    trackServerEvent(EVENT_OWNER_LOGGED_IN, { method: 'password_api' }, { distinctId: email })

    const response = jsonPrivate({ authenticated: true, email })
    return await setOwnerSessionCookie(response, owner)
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      logDbError(error, '/api/owner/login', Date.now())
      return jsonPrivate({ error: getSafeDbErrorMessage(error, '/api/owner/login') }, 503)
    }
    console.error('[api/owner/login] Unexpected error:', error)
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

        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject,
          text: `Hi,

You requested to ${purpose === 'password_reset' ? 'reset your SnapRooms password' : 'set up your SnapRooms dashboard password'}.

${actionText} here:
${actionUrl}

This link expires in ${expiryText}.

If you did not request this, you can safely ignore this email.

– SnapRooms`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;"><span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span></div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">${subject}</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">Tap the button below. This link is valid for ${expiryText}.</p>
  <p style="margin:0 0 24px;text-align:center;"><a href="${actionUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${actionText}</a></p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">If you did not request this, you can safely ignore this email.<br>SnapRooms — Every guest photo. One room.</p>
</div>`,
        })
      } catch (emailError) {
        console.error('[forgotOwnerPassword] Failed to send email:', emailError)
      }
    }
  } catch (error) {
    console.error('[forgotOwnerPassword] Unexpected error:', error)
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
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'setup_password', client_ip: clientIp }, { distinctId: clientIp })
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
  trackServerEvent(EVENT_OWNER_CLAIM_COMPLETED, {}, { distinctId: owner.email })

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

  const { managementTokenHash, photographerUploadTokenHash, ...safeEvent } = event
  return jsonPrivate({ event: { ...safeEvent, hasPhotographerUploadLink: Boolean(photographerUploadTokenHash) } })
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
      console.error('[updateOwnerEvent] Storage cleanup failed for cover:', event.coverUrl, storageError)
    }
  }

  const updatedEvent = await repository.updateEvent(slug, payload)
  return jsonPrivate({ event: updatedEvent })
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
  const photoSourceUrls = await repository.listPhotoSourcesByEventId(event.id)
  const privateAssets = await repository.listPrivateAssetsByEventId(event.id)

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

  if (photo.status === 'HIDDEN') {
    await deletePhotoDerivatives(photo.id, { context: 'moderateOwnerPhoto' })
  }

  console.log(`[audit] Owner ${ownerEmail} ${payload.action}d photo ${photoId} in event ${photo.eventId}`)
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
    console.error('[deleteOwnerPhoto] Storage cleanup failed for photo:', photoId, storageError)
  }

  // Same shared helper as the admin path — derivative identity is never
  // reconstructed at a call site.
  await deletePhotoDerivatives(photo.id, { context: 'deleteOwnerPhoto' })

  console.log(`[audit] Owner ${ownerEmail} deleted photo ${photoId} from event ${photo.eventId}`)
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

      if (segments.length === 2 && segments[1] === 'events' && method === 'GET') {
        return listOwnerEvents(request)
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'GET') {
        return getOwnerEvent(request, segments[2])
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

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'photographer-link' && method === 'POST') {
        return createPhotographerUploadLink(request, segments[2])
      }

      if (segments.length === 4 && segments[1] === 'events' && segments[3] === 'photographer-link' && method === 'DELETE') {
        return deletePhotographerUploadLink(request, segments[2])
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

    if (segments[0] === 'events') {
      if (segments.length === 1 && method === 'GET') {
        return listEvents()
      }

      if (segments.length === 1 && method === 'POST') {
        return createEvent(request)
      }

      if (segments.length === 2 && method === 'GET') {
        return getEvent(segments[1])
      }

      if (segments.length === 3 && segments[2] === 'photos' && method === 'GET') {
        return getEventPhotos(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'gallery-download' && method === 'POST') {
        return createGalleryDownload(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'gallery-download' && method === 'GET') {
        return getGalleryDownload(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'email' && method === 'POST') {
        return saveEventByEmail(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'owner' && method === 'POST') {
        return saveEventOwner(request, segments[1])
      }

      if (segments.length === 2 && method === 'PATCH') {
        return updateEvent(request, segments[1])
      }

      if (segments.length === 2 && method === 'DELETE') {
        return deleteEvent(request, segments[1])
      }
    }

    if (segments[0] === 'uploads') {
      if (segments.length === 2 && segments[1] === 'init' && method === 'POST') {
        return initUpload(request)
      }

      if (segments.length === 2 && segments[1] === 'blob' && method === 'POST') {
        return issueBlobUploadToken(request)
      }

      if (segments.length === 2 && segments[1] === 'chunk' && method === 'POST') {
        return uploadChunk(request)
      }

      if (segments.length === 2 && segments[1] === 'complete' && method === 'POST') {
        return completeUpload(request)
      }
    }

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
