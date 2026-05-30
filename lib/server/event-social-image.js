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
 */
export function resolveEventSocialImage(event, visiblePhotos = []) {
  if (!event) return null

  if (event.socialCoverUrl) return event.socialCoverUrl
  if (event.coverUrl) return event.coverUrl

  const firstVisible = visiblePhotos.find((p) => p.status === 'VISIBLE')
  if (firstVisible?.url) return firstVisible.url

  return null
}
