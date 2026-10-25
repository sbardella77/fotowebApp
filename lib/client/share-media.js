/**
 * Social sharing for room photos (and, later, videos).
 *
 * Instagram and TikTok expose NO web share URL: the only way a browser can
 * hand them a photo/video is the OS share sheet via the Web Share API Level 2
 * (`navigator.share({ files })`), which mobile Safari/Chrome support. So the
 * primary path always shares the FILE itself; link-based networks (Facebook,
 * WhatsApp, X) are a fallback for desktop browsers without file sharing.
 *
 * The shared bytes always come from the same `/api/download/photo` standard
 * representation the download button uses — never `photo.url` and never the
 * original — so sharing can never leak more than a guest may download, and
 * Free rooms keep their branded (viral) rendition.
 */

export const SHARE_NETWORKS = ['facebook', 'whatsapp', 'x']

export function buildShareLinks({ pageUrl, text = '' }) {
  const u = encodeURIComponent(pageUrl)
  const t = encodeURIComponent(text)
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    whatsapp: `https://wa.me/?text=${text ? `${t}%20` : ''}${u}`,
    x: `https://twitter.com/intent/tweet?url=${u}${text ? `&text=${t}` : ''}`,
  }
}

export function canShareFiles(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'probe.jpg', { type: 'image/jpeg' })
    return nav.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/**
 * Fetches the standard rendition of a photo as a shareable File.
 *
 * Split from `shareFile` on purpose: Safari only honours `navigator.share`
 * inside a fresh user gesture, and awaiting a download can outlive it. The
 * caller caches this File so a second tap can share synchronously.
 */
export async function fetchPhotoShareFile(photoId, fetchImpl = fetch) {
  const response = await fetchImpl(`/api/download/photo?photoId=${encodeURIComponent(photoId)}&type=standard`)
  if (!response.ok) throw new Error(`Share fetch failed: ${response.status}`)
  const blob = await response.blob()
  const type = blob.type || 'image/jpeg'
  const ext = type.split('/')[1] || 'jpg'
  return new File([blob], `snaprooms-${photoId}.${ext}`, { type })
}

/**
 * Opens the native share sheet for a file.
 * Returns 'shared' | 'cancelled' | 'unsupported' | 'needs-gesture'.
 */
export async function shareFile(file, { title, nav = navigator } = {}) {
  if (!canShareFiles(nav) || !nav.canShare({ files: [file] })) return 'unsupported'
  try {
    await nav.share({ files: [file], title })
    return 'shared'
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled'
    if (e?.name === 'NotAllowedError') return 'needs-gesture'
    throw e
  }
}
