/**
 * Server-derived actor classification for gallery Photo uploads.
 *
 * Analytics attribution only — never authorization. A GUEST classification
 * never blocks, degrades, or rejects an upload: anonymous guest uploads are
 * expected, normal behavior and must keep working exactly as before this
 * field existed. This never grants permissions, unlocks paid features,
 * changes download/upload access, bypasses rate limiting, or affects
 * billing — it only records who the server believes made the upload, for
 * later product-analytics queries (e.g. Core Activation).
 *
 * Never trust a client-supplied value (isOwner flag, actorType, email,
 * contributorId, uploaderName) for this classification — only a
 * server-verified owner session counts.
 */

export const UPLOAD_ACTOR_OWNER = 'owner'
export const UPLOAD_ACTOR_GUEST = 'guest'

/**
 * Pure classification rule — unit-testable without cookies, sessions, or
 * Prisma. Binary by design: everything that is not a confirmed, matching
 * owner is GUEST (no session, expired/invalid session, a valid session for
 * a different owner, or an event with no owner at all).
 *
 * @param {Object} params
 * @param {string|null} params.verifiedOwnerEmail - result of the existing
 *   owner-session cookie verification (verifyOwnerSessionToken), never a
 *   client-supplied value.
 * @param {string|null} params.eventOwnerEmail - Event.ownerEmail; null for
 *   an ownerless event.
 * @returns {'owner'|'guest'}
 */
export function classifyGalleryUploadActor({ verifiedOwnerEmail, eventOwnerEmail }) {
  if (!verifiedOwnerEmail || !eventOwnerEmail) {
    return UPLOAD_ACTOR_GUEST
  }

  return verifiedOwnerEmail.toLowerCase().trim() === eventOwnerEmail.toLowerCase().trim()
    ? UPLOAD_ACTOR_OWNER
    : UPLOAD_ACTOR_GUEST
}
