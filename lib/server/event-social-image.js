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
 * Live OG/social image resolver (Guest EXIF Safe Delivery Cutover — wired
 * into app/event/[slug]/page.js's generateMetadata).
 *
 * Fallback chain:
 * 1. event.socialCoverUrl        (dedicated social cover — not yet in schema)
 * 2. first visible READY photo   (sanitized derivative only)
 * 3. null                        (use default OG image)
 *
 * NEVER falls back to an original Photo.url under any circumstance —
 * this is the one behavioral difference from resolveEventSocialImage
 * above, and the entire reason this function exists. A visible photo
 * that is PENDING/FAILED/LEGACY_UNVERIFIED is simply skipped in favor of
 * the next visible photo, exactly like resolveEventSocialImage skips
 * non-VISIBLE ones.
 *
 * event.coverUrl is deliberately EXCLUDED from this chain (unlike
 * resolveEventSocialImage above) — verified directly against
 * lib/server/event-cover-storage.js#optimizeCoverBuffer and its one
 * caller: cover upload falls back to the RAW, UNPROCESSED uploaded buffer
 * whenever Sharp is unavailable or throws (`const uploadBuffer = optimized
 * ? optimized.buffer : buffer`), so coverUrl can point at un-re-encoded,
 * potentially EXIF-bearing bytes. That safety property is not proven, so
 * per the cutover's fail-closed policy this resolver skips straight past
 * it to the next candidate rather than trusting it. If
 * optimizeCoverBuffer's fallback is ever closed (e.g. reject the upload
 * instead of falling back, with a byte-level test proving it), coverUrl
 * can be reinstated here.
 *
 * @param {object} event
 * @param {Array<{id: string, status: string, displayDerivativeStatus: string}>} visiblePhotos
 * @returns {string|null}
 */
export function resolveEventSocialImageSafe(event, visiblePhotos = []) {
  if (!event) return null

  if (event.socialCoverUrl) return event.socialCoverUrl

  for (const photo of visiblePhotos) {
    if (photo.status !== 'VISIBLE') continue
    const safeUrl = resolveGuestPhotoUrl(photo)
    if (safeUrl) return safeUrl
  }

  return null
}
