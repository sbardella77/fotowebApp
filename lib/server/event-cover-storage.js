import { deleteStoredFile } from './storage'

/**
 * Returns true only if the URL belongs to a SnapRooms-managed event cover.
 * Covers live under: covers/{slug}/...
 *
 * Rules:
 * - true only for dedicated cover paths
 * - false for null/undefined, external URLs, guest photos,
 *   private delivery assets, photographer uploads, or any non-cover path
 */
export function isManagedEventCoverUrl(url, slug) {
  if (!url || typeof url !== 'string') return false
  if (!slug || typeof slug !== 'string') return false

  // Only recognize paths that contain our dedicated cover directory for this slug.
  // This prevents accidental deletion of guest photos, private assets, or external URLs.
  return url.includes(`/covers/${slug}/`)
}

/**
 * Safely deletes a managed event cover from storage.
 * Returns true if deleted or nothing to do, false on unexpected failure.
 * Storage failures are logged and must never block DB updates or user flows.
 */
export async function deleteManagedEventCover(url, slug) {
  if (!isManagedEventCoverUrl(url, slug)) {
    return true // Not managed by us — nothing to delete
  }

  try {
    await deleteStoredFile(url)
    return true
  } catch (err) {
    console.error('[deleteManagedEventCover] Storage cleanup failed:', url, err)
    return false
  }
}

/**
 * Builds the storage pathname for a new cover file.
 */
export function getCoverStoragePath(slug, filename) {
  if (!slug || !filename) throw new Error('slug and filename are required')
  return `covers/${slug}/${filename}`
}

/**
 * Optimize a cover image buffer for dashboard/card usage.
 * Target: 1200×675 (16:9) WebP quality 80.
 *
 * If sharp is unavailable or fails, returns null so the caller
 * can fall back to the original buffer.
 */
export async function optimizeCoverBuffer(inputBuffer, options = {}) {
  const { width = 1200, height = 675, quality = 80 } = options

  let sharp
  try {
    sharp = (await import('sharp')).default
  } catch {
    console.warn('[optimizeCoverBuffer] sharp not available, skipping optimization')
    return null
  }

  try {
    const optimized = await sharp(inputBuffer)
      .resize(width, height, { fit: 'cover', withoutEnlargement: false })
      .webp({ quality, effort: 4 })
      .toBuffer()

    return { buffer: optimized, format: 'webp', contentType: 'image/webp' }
  } catch (err) {
    console.error('[optimizeCoverBuffer] sharp optimization failed, using original:', err.message)
    return null
  }
}
