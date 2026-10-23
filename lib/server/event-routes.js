// Shared business logic behind the guest-facing Event routes, moved out of
// the legacy app/api/[[...path]]/route.js catch-all so it can be reused by
// both the discrete App Router handlers (app/api/events/**) and the
// admin-session-wrapped endpoints that still live in the catch-all
// (listAdminEvents/createAdminEvent/getAdminEvent delegate to listEvents/
// createEvent/getEvent below; deleteOwnerEvent delegates to
// cleanupBlobsAfterEventDelete below). Behavior, status codes, and rate
// limiting are unchanged from the original inline functions.
import {
  generateManagementToken,
  hashManagementToken,
  verifyManagementToken,
} from '@/lib/server/management-token'
import { buildEmail } from '@/lib/server/email/email-layout'
import { createEventSchema, saveOwnerEmailSchema, updateEventSchema } from '@/lib/server/schemas'
import { getGalleryRepository, getGalleryRepositoryMode } from '@/lib/server/gallery-repository'
import {
  checkRateLimit,
  rateLimit,
  getClientIp,
  hashIdentifier,
  RATE_LIMITS,
} from '@/lib/server/rate-limiter'
import { withTiming } from '@/lib/server/timing'
import {
  GALLERY_EXPORT_UNAVAILABLE_CODE,
  getLatestGalleryDownloadJob,
  toClientGalleryDownloadJob,
} from '@/lib/server/gallery-download-job'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { getOwnerAnalyticsId } from '@/lib/analytics/identity'
import {
  EVENT_ROOM_CREATED,
  EVENT_RATE_LIMIT_HIT,
  EVENT_FREE_ROOM_LIMIT_HIT,
} from '@/lib/analytics/events'
import { getAdminAuthDriver, getDataAccessDriver, getPrismaClient } from '@/lib/server/prisma-client'
import { deleteStoredFile, getStorageMode } from '@/lib/server/storage'
import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'
import { deletePhotoDerivativesBatch } from '@/lib/server/derivative-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import { serializeProviderError } from '@/lib/server/safe-log'
import { checkOwnerRoomCreationEntitlement } from '@/lib/server/entitlements'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { deleteManagedEventCover } from '@/lib/server/event-cover-storage'
import { createPasswordResetTokenForOwner } from '@/lib/server/password-reset-tokens'
import { getAdminAuthStatus } from '@/lib/server/admin-auth'
import { resend } from '@/lib/server/resend-client'
import {
  json,
  formatZodError,
  buildRateLimitResponse,
  getManagementTokenFromRequest,
} from '@/lib/server/api-response'

export const getAppUrl = (request) => {
  const envUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (envUrl) return envUrl.replace(/\/$/, '')

  console.error('[getAppUrl] APP_URL/NEXT_PUBLIC_APP_URL not configured; refusing to build URLs from the Host header')
  return null
}

export const routeRoot = async () => {
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

export const sendOwnerNotificationEmail = async ({ email, event, owner, request }) => {
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
      const setupEmail = buildEmail({
        subject: 'Set your SnapRooms password',
        headline: 'Set your password',
        bodyLines: [
          `Your room "${event.name}" is ready. Create a password to manage all your rooms in one place.`,
          `This link expires in 24 hours. If you didn't create this room, you can safely ignore this email.`,
        ],
        cta: { text: 'Set password', url: setupUrl },
        locale: 'en',
        appUrl,
      })
      const { error: setupSendError } = await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject: setupEmail.subject,
        text: setupEmail.text,
        html: setupEmail.html,
      })
      if (setupSendError) {
        console.error('[sendOwnerNotificationEmail] Resend error (setup_password):', serializeProviderError('resend', 'send_owner_notification_setup_password', setupSendError))
      }
    } else {
      const dashboardUrl = `${appUrl}/dashboard`
      const roomAddedEmail = buildEmail({
        subject: `Your SnapRooms room "${event.name}"`,
        headline: 'Room added to your dashboard',
        bodyLines: [`Your room "${event.name}" is now in your dashboard.`],
        cta: { text: 'Open dashboard', url: dashboardUrl },
        locale: 'en',
        appUrl,
      })
      const { error: addedSendError } = await resend.emails.send({
        from,
        to: email,
        reply_to: 'hello@snaprooms.app',
        subject: roomAddedEmail.subject,
        text: roomAddedEmail.text,
        html: roomAddedEmail.html,
      })
      if (addedSendError) {
        console.error('[sendOwnerNotificationEmail] Resend error (room_added):', serializeProviderError('resend', 'send_owner_notification_room_added', addedSendError))
      }
    }
  } catch (emailError) {
    console.error('[sendOwnerNotificationEmail] Failed to send owner email:', serializeProviderError('resend', 'send_owner_notification', emailError))
  }
}

export const createEvent = async (request) => {
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
    trackServerEvent(EVENT_RATE_LIMIT_HIT, { reason: 'create_event' }, { distinctId: 'rate_limit:create_event', personProfile: false })
    return json({ error: 'Too many rooms created. Please try again later.' }, 429)
  }

  const repository = await getGalleryRepository()

  let event = null
  let extraEventCreditConsumed = false
  let ownerIdForAnalytics = null

  // If owner email provided, enforce Free plan room limit before creating
  if (payload.ownerEmail) {
    const prisma = await getPrismaClient()
    const owner = await repository.getOrCreateOwnerByEmail(payload.ownerEmail)
    ownerIdForAnalytics = owner?.id || null
    if (prisma && owner) {
      const entitlement = await checkOwnerRoomCreationEntitlement(prisma, owner)
      if (!entitlement.allowed) {
        trackServerEvent(
          EVENT_FREE_ROOM_LIMIT_HIT,
          {
            current_rooms: entitlement.current,
            limit: entitlement.max,
            extra_event_credits: entitlement.extraEventCredits,
          },
          { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true }
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
          console.error('[api/events] Extra event credit transaction failed:', serializeProviderError('db', 'extra_event_credit_transaction', txError))
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

  // Owner-attributed room creation is a real Person action; a room created
  // with no owner (payload.ownerEmail absent) has no known actor at all —
  // it must not collapse into a shared literal 'anonymous' Person, so it's
  // captured as a non-person, room-scoped event instead.
  const roomCreatedOwnerId = getOwnerAnalyticsId(ownerIdForAnalytics)
  trackServerEvent(
    EVENT_ROOM_CREATED,
    {
      room_slug: event.slug,
      has_owner_email: Boolean(payload.ownerEmail),
      extra_event_credit_used: extraEventCreditConsumed,
    },
    roomCreatedOwnerId
      ? { distinctId: roomCreatedOwnerId, personProfile: true }
      : { distinctId: `room:${event.slug}`, personProfile: false }
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

export const listEvents = async () => {
  const repository = await getGalleryRepository()
  const events = await repository.listEvents()
  return json({ events })
}

export const getEvent = async (slug, options = {}) => {
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
    stripeCheckoutSessionId,
    originalDownloadCheckoutSessionId,
    ...publicEvent
  } = event
  return json({ event: { ...publicEvent, ownerPlan } })
}

export const getEventPhotos = withTiming('getEventPhotos', async (request, slug) => {
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

export const createGalleryDownload = withTiming('createGalleryDownload', async (request, slug) => {
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

  // Async (persisted) gallery export is disabled until a private export
  // store exists. Refused server-side so a stale client cannot recreate the
  // old public-ZIP flow; galleries within the sync limit use
  // /api/download/gallery instead.
  return json(
    {
      error: 'Full gallery export is temporarily unavailable for this gallery',
      code: GALLERY_EXPORT_UNAVAILABLE_CODE,
    },
    409
  )
})

export const getGalleryDownload = withTiming('getGalleryDownload', async (request, slug) => {
  const clientIp = getClientIp(request)
  const rateLimitCheck = await checkRateLimit(
    `gallery-download:status:ip:${hashIdentifier(clientIp)}:event:${slug}`,
    RATE_LIMITS.galleryDownloadStatus.ip.max,
    RATE_LIMITS.galleryDownloadStatus.ip.window
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

  // Entitlement is recomputed on every poll — never trusted from the client
  // and never assumed from the job having been created earlier. If it cannot
  // be resolved, fail closed.
  let access
  try {
    access = await getEffectiveEventAccessState(prisma, event)
  } catch (accessError) {
    console.error('[getGalleryDownload] entitlement resolution failed:', serializeProviderError('db', 'gallery_download_status', accessError))
    return json({ error: 'Gallery download status is temporarily unavailable' }, 503)
  }
  if (access?.canDownloadGallery !== true) {
    return json({ error: 'Gallery download is not available for this event' }, 403)
  }

  // Read-only: this endpoint never processes, generates or uploads anything.
  const job = await getLatestGalleryDownloadJob(event.id)
  return json({ job: toClientGalleryDownloadJob(job) })
})

export const saveEventByEmail = async (request, slug) => {
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
    const roomReadyEmail = buildEmail({
      subject: 'Your SnapRooms room is ready',
      headline: 'Your room is ready',
      bodyLines: [
        `Your room "${event.name}" is ready. Share the link below with your guests so they can upload their photos.`,
        `If you didn't request this email, you can ignore it.`,
      ],
      cta: { text: 'Open your room', url: eventUrl },
      linkBox: { label: 'Room link', url: eventUrl },
      locale: 'en',
      appUrl,
    })
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: email,
      reply_to: 'hello@snaprooms.app',
      subject: roomReadyEmail.subject,
      text: roomReadyEmail.text,
      html: roomReadyEmail.html,
    })

    if (sendError) {
      console.error('[saveEventByEmail] Resend error:', serializeProviderError('resend', 'save_event_by_email', sendError))
      return json({ error: sendError.message || 'Unable to send email' }, 502)
    }

    return json({ success: true, id: data?.id })
  } catch (error) {
    console.error('[saveEventByEmail] Unexpected error:', serializeProviderError('resend', 'save_event_by_email', error))
    return json({ error: error?.message || 'Unable to send email' }, 502)
  }
}

export const saveEventOwner = async (request, slug) => {
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
            current_rooms: entitlement.current,
            limit: entitlement.max,
          },
          { distinctId: getOwnerAnalyticsId(owner.id), personProfile: true }
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

export const updateEvent = async (request, slug) => {
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
export async function cleanupBlobsAfterEventDelete({
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
    // sendOpsAlert's own implementation never throws today (every branch,
    // including the provider call, is caught and returns a plain result
    // object). This try/catch is a structural boundary, not a hedge against
    // a known failure mode: the Event row is already gone by the time we get
    // here, so alert *delivery* must never be able to turn a committed
    // deletion into a rejected request, even under a future change to
    // ops-alerts.js. Its context is forwarded close to verbatim (only
    // key-name filtering) to the alert recipient — never pass a URL, slug or
    // filename here.
    try {
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
    } catch (alertError) {
      console.error(`[${operation}] Post-delete ops alert failed:`, alertError?.name)
    }
  }
}

export const deleteEvent = withTiming('deleteEvent', async (request, slug) => {
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
  // no way to rediscover which PrivateAsset rows belonged to it. Deliberately
  // NOT listPrivateAssetsByEventId: that method degrades to [] when Prisma
  // is unavailable (correct for its own caller, the private-delivery listing
  // endpoint), which would be indistinguishable from "zero PrivateAssets"
  // here and silently orphan them (STEP 7.15d.3-b).
  const privateAssets = await repository.listPrivateAssetsForEventDeletion(event.id)

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
