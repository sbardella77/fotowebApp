/**
 * Shared (client + server) constant for the unverified-owner photo cap.
 * A free room whose owner hasn't verified their email (Owner.emailVerifiedAt
 * IS NULL) — or that has no owner at all — holds at most this many photos.
 * Enforced server-side in lib/server/entitlements.js; the client only uses
 * it for copy.
 */
export const UNVERIFIED_PHOTO_LIMIT = 30
