import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { OWNER_WATERMARK_ACCESS_SELECT, resolveActiveWatermark } from '@/lib/server/photographer-watermark-config'

/**
 * Server-side delivery decisions for the photographer watermark.
 *
 * Who gets the watermark: every guest-facing image of an event whose owner
 * has an active watermark. The event's own owner, authenticated by session,
 * downloads clean originals — the threat model is guests redistributing
 * photos, not the photographer.
 *
 * Only `event.ownerId` is consulted, matching entitlements: legacy events
 * with just an ownerEmail get no watermark.
 */

const OWNER_DELIVERY_SELECT = Object.freeze({ ...OWNER_WATERMARK_ACCESS_SELECT, email: true })

async function loadOwner(prisma, ownerId) {
  if (!prisma || !ownerId) return null
  return prisma.owner.findUnique({ where: { id: ownerId }, select: OWNER_DELIVERY_SELECT })
}

/** Active watermark spec for an owner id, or null. */
export async function getActiveWatermarkForOwnerId(prisma, ownerId) {
  return resolveActiveWatermark(await loadOwner(prisma, ownerId))
}

/** Active watermark spec for an event's owner, or null. */
export async function getActiveWatermarkForEvent(prisma, event) {
  return getActiveWatermarkForOwnerId(prisma, event?.ownerId)
}

/** Email of the owner session carried by the request, or null. Never throws. */
export async function getRequestOwnerEmail(request) {
  try {
    const token = request?.cookies?.get?.(OWNER_COOKIE_NAME)?.value
    if (!token) return null
    return await verifyOwnerSessionToken(token)
  } catch {
    return null
  }
}

function sameEmail(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Watermark for a download request: the owner's active spec, or null when
 * there is none or the request carries the event owner's own session.
 * Throws on lookup failure — callers must fail the download rather than
 * serve a clean file.
 */
export async function getDownloadWatermark(prisma, event, request) {
  const owner = await loadOwner(prisma, event?.ownerId)
  const watermark = resolveActiveWatermark(owner)
  if (!watermark) return null
  return sameEmail(await getRequestOwnerEmail(request), owner?.email) ? null : watermark
}
