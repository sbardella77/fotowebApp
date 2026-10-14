import { normalizeContributorId } from '@/lib/server/contributor-id'
import { classifyGalleryUploadActor } from '@/lib/server/gallery-upload-actor'
import { uploadInitSchema } from '@/lib/server/schemas'
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStorageDriver } from '@/lib/server/storage'
import { checkRoomUploadEntitlement } from '@/lib/server/entitlements'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_FREE_PHOTO_LIMIT_HIT } from '@/lib/analytics/events'
import { BlobUploadKind } from '@prisma/client'
import { createServerBoundBlobUploadInit } from '@/lib/server/blob-upload-init'
import { json } from '@/lib/server/api-response'

export const runtime = 'nodejs'

const getOwnerAuthentication = async (request) => {
  const token = request.cookies.get(OWNER_COOKIE_NAME)?.value
  return verifyOwnerSessionToken(token)
}

// Moved verbatim out of the legacy app/api/[[...path]]/route.js catch-all
// (previously `initUpload`). Behavior, status codes, and rate limiting are
// unchanged — deliberately NOT wrapped in a generic try/catch: the original
// handler had none of its own (only the specific inline error handling
// below), and any other thrown error was already propagating all the way out
// of the legacy catch-all's dispatcher uncaught (a bare `return handler(...)`
// inside an async function hands control back before the returned promise
// settles, so it never reaches that dispatcher's own try/catch). Preserving
// that exact behavior here, rather than catching generically, keeps parity
// with production error handling for this route.
export async function POST(request) {
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

  const storageDriver = getStorageDriver()

  // Best-effort, analytics-only — never trusted for security/billing/gating.
  // A malformed/missing value normalizes to null and never blocks the
  // upload (see lib/server/contributor-id.js).
  const contributorId = normalizeContributorId(payload.contributorId)

  // Analytics attribution only — never authorization. Resolved once, here,
  // from the request's own owner-session cookie (never client-supplied),
  // and bound into the session so it cannot be altered by the completion
  // payload. A missing/invalid/mismatched session simply classifies as
  // 'guest' and never blocks or degrades the upload. See
  // lib/server/gallery-upload-actor.js.
  const verifiedOwnerEmail = await getOwnerAuthentication(request)
  const uploadActorType = classifyGalleryUploadActor({
    verifiedOwnerEmail,
    eventOwnerEmail: event.ownerEmail,
  })

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
      contributorId,
      uploadActorType,
    })

    return json({ session }, 201)
  }

  const session = await storageDriver.initUploadSession({ ...payload, contributorId, uploadActorType })
  return json({ session }, 201)
}

export async function OPTIONS() {
  return json({ ok: true })
}
