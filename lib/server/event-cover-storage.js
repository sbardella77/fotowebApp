import { deleteStoredFile } from './storage'

/**
 * Returns true only if the URL is a SnapRooms-managed event cover Blob URL
 * for the exact owning event slug.
 *
 * Managed covers are Vercel Blob HTTPS URLs with the pathname structure:
 *   /covers/{slug}/{filename}
 *
 * Validation requirements:
 *   - https: protocol
 *   - hostname ends with .blob.vercel-storage.com (subdomain required)
 *   - no credentials, port, query string, or fragment
 *   - no %, backslash, or NUL in pathname
 *   - exactly 3 non-empty pathname segments — no dot segments
 *   - segment[0] === 'covers'
 *   - segment[1] === slug (exact match — no prefix collision)
 *   - segment[2].length > 0 (non-empty filename)
 *   - slug must not contain /, \, %, NUL, '.', '..'
 *
 * External URLs (e.g. https://example.com/image.jpg) are intentionally
 * allowed in the DB but return false here — they are never storage-deleted.
 */
export function isManagedEventCoverUrl(url, slug) {
  if (!url || typeof url !== 'string') return false
  if (!slug || typeof slug !== 'string' || slug.length === 0) return false

  // Guard slug against separator injection
  if (
    slug.includes('/') ||
    slug.includes('\\') ||
    slug.includes('\0') ||
    slug.includes('%') ||
    slug === '.' ||
    slug === '..'
  ) return false

  // Reject non-canonical raw input BEFORE URL parsing.
  // new URL() may normalize: backslash → '/', percent-encoded sequences,
  // dot segments (%2e%2e), etc. — any such input is not server-generated.
  if (url.includes('\0') || url.includes('\\') || url.includes('%')) return false

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // Canonicality guard: require that the URL serializes back to the original.
  // Server-generated Vercel Blob URLs are always canonical. Any normalization
  // by the parser (dot segments, explicit :443, uppercase scheme/host, etc.)
  // indicates a non-server-generated input — reject rather than validate a
  // transformed version.
  if (parsed.href !== url) return false

  if (parsed.protocol !== 'https:') return false

  // Hostname must be a subdomain of .blob.vercel-storage.com — bare host rejected
  const suffix = '.blob.vercel-storage.com'
  if (!parsed.hostname.endsWith(suffix)) return false
  if (parsed.hostname.length <= suffix.length) return false

  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '') return false
  if (parsed.search !== '' || parsed.hash !== '') return false

  const p = parsed.pathname

  // Reject double-slash explicitly — new URL() does NOT normalize // in paths,
  // so canonicality alone does not catch /covers//event-a/file.webp.
  if (p.includes('//')) return false

  // Exact segment parsing — do NOT use filter(Boolean).
  // Expected structure: '' / 'covers' / slug / filename
  // Any empty segment (double-slash, leading/trailing slash variants) fails.
  const segs = p.split('/')
  if (segs.length !== 4) return false
  if (segs[0] !== '') return false
  if (segs[1] !== 'covers') return false
  if (segs[2] !== slug) return false
  if (segs[3].length === 0) return false

  return true
}

/**
 * Safely deletes a managed event cover from storage.
 * Returns true if deleted or nothing to do, false on unexpected failure.
 * Storage failures are logged and must never block DB updates or user flows.
 *
 * If the URL is not a managed cover (external URL, poisoned URL, etc.),
 * returns true without calling storage — the DB record can still be updated.
 */
export async function deleteManagedEventCover(url, slug) {
  if (!isManagedEventCoverUrl(url, slug)) {
    return true // Not managed — nothing to delete
  }

  try {
    await deleteStoredFile(url)
    return true
  } catch {
    console.error('[deleteManagedEventCover] Storage cleanup failed')
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
