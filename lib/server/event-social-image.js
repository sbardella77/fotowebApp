import { resolveGuestPhotoUrl } from '@/lib/server/guest-photo-url'

/**
 * Resolves the social sharing image for an event.
 *
 * Fallback chain (future-proof):
 * 1. event.socialCoverUrl  (dedicated social cover — field not yet in schema)
 * 2. event.coverUrl        (manual event cover)
 * 3. first visible photo   (guest photo fallback)
 * 4. null                  (use default OG image)
 *
 * Never uses hidden/rejected photos, private delivery assets,
 * or photographer upload files.
 *
 * PRIVACY NOTE (TASK-03 Phase 1A): step 3 above falls back to the
 * ORIGINAL Photo.url, unchanged. This is a genuine, currently-live
 * exposure vector — social-platform crawlers (Facebook/Slack/Twitter
 * unfurl bots) fetch and often cache/re-host this image externally,
 * outside SnapRooms' control, indefinitely. This function's behavior is
 * deliberately NOT changed here (that would be a guest-visible cutover,
 * out of scope for this phase) — see resolveEventSocialImageSafe below
 * for the future policy this will be replaced by.
 */
export function resolveEventSocialImage(event, visiblePhotos = []) {
  if (!event) return null

  if (event.socialCoverUrl) return event.socialCoverUrl
  if (event.coverUrl) return event.coverUrl

  const firstVisible = visiblePhotos.find((p) => p.status === 'VISIBLE')
  if (firstVisible?.url) return firstVisible.url

  return null
}

/**
 * Future-policy OG/social image resolver (TASK-03 Phase 1A — plumbing
 * only, NOT wired into any page yet).
 *
 * Fallback chain:
 * 1. event.socialCoverUrl        (dedicated social cover — not yet in schema)
 * 2. event.coverUrl              (manual event cover — see caveat below)
 * 3. first visible READY photo   (sanitized derivative only)
 * 4. null                        (use default OG image)
 *
 * NEVER falls back to an original Photo.url under any circumstance —
 * this is the one behavioral difference from resolveEventSocialImage
 * above, and the entire reason this function exists. A visible photo
 * that is PENDING/FAILED/LEGACY_UNVERIFIED is simply skipped in favor of
 * the next visible photo, exactly like resolveEventSocialImage skips
 * non-VISIBLE ones.
 *
 * Caveat on step 2 (documented, not fixed here): event.coverUrl goes
 * through lib/server/event-cover-storage.js#optimizeCoverBuffer, which
 * strips metadata via Sharp re-encoding on its success path, but falls
 * back to an UNPROCESSED buffer if Sharp is unavailable or throws. Unlike
 * the display-v1 derivative, there is no dedicated byte-level test
 * proving coverUrl is always EXIF-free. It is treated as acceptable here
 * because it is explicitly owner-provided branding content (not a
 * guest's uploaded photo), not because it has the same proof standard as
 * READY — flagged for whoever wires this in to decide if that's enough.
 *
 * @param {object} event
 * @param {Array<{id: string, status: string, displayDerivativeStatus: string}>} visiblePhotos
 * @returns {string|null}
 */
export function resolveEventSocialImageSafe(event, visiblePhotos = []) {
  if (!event) return null

  if (event.socialCoverUrl) return event.socialCoverUrl
  if (event.coverUrl) return event.coverUrl

  for (const photo of visiblePhotos) {
    if (photo.status !== 'VISIBLE') continue
    const safeUrl = resolveGuestPhotoUrl(photo)
    if (safeUrl) return safeUrl
  }

  return null
}
