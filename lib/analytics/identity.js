const OWNER_ID_PREFIX = 'owner:'

/**
 * Builds the PostHog analytics identity for an authenticated Owner.
 *
 * Pure and environment-agnostic (no browser/server/PostHog dependency) so
 * the exact same function can be imported from client bundles and server
 * code, guaranteeing client and server always compute a byte-identical
 * distinct_id for the same Owner.
 *
 * Never derives an identity from email — only Owner.id, SnapRooms' existing
 * internal, non-public identifier. If Owner.id is unavailable, returns null
 * rather than fabricating or falling back to email.
 *
 * @param {unknown} ownerId
 * @returns {string|null} `owner:<Owner.id>`, or null if ownerId is invalid
 */
export function getOwnerAnalyticsId(ownerId) {
  if (typeof ownerId !== 'string') return null
  const trimmed = ownerId.trim()
  if (!trimmed) return null
  return `${OWNER_ID_PREFIX}${trimmed}`
}
