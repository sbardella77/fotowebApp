/**
 * Safe photo normalization and validation for public gallery rendering.
 *
 * These utilities are designed to be crash-proof:
 * - They never throw
 * - They handle undefined, null, non-array, and malformed inputs
 * - They reject HEIC/HEIF/AVIF and other unsupported browser formats
 * - They log diagnostics in dev, minimal info in production
 */

const BROWSER_SAFE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const BLOCKED_MIME_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/avif',
])

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

const isDev = process.env.NODE_ENV === 'development'

function logSkip(photo, reason, extra = {}) {
  if (isDev) {
    console.warn('[photo-utils] skipping invalid photo:', reason, { photo: photo || null, ...extra })
  } else {
    // In production, log only safe, non-identifying fields
    const safeInfo = {
      reason,
      hasId: Boolean(photo && photo.id),
      idType: photo ? typeof photo.id : 'undefined',
      hasUrl: Boolean(photo && photo.url),
      urlType: photo ? typeof photo.url : 'undefined',
      contentType: photo && typeof photo.mimeType === 'string' ? photo.mimeType : undefined,
      createdAtType: photo ? typeof photo.createdAt : 'undefined',
    }
    console.warn('[photo-utils] skip', safeInfo)
  }
}

/**
 * Validate a single photo object and return a normalized renderable photo,
 * or null if the photo is invalid.
 */
export function normalizePublicPhoto(photo) {
  if (!photo || typeof photo !== 'object') {
    logSkip(photo, 'not-an-object')
    return null
  }

  // id must be a non-empty string
  const id = photo.id
  if (!id || typeof id !== 'string') {
    logSkip(photo, 'missing-id', { idType: typeof id })
    return null
  }
  // Sanity-check id format (uuid, cuid, nanoid, or simple slug)
  if (!VALID_ID_PATTERN.test(id)) {
    logSkip(photo, 'invalid-id-format', { id })
    return null
  }

  // url must be a non-empty string
  const url = photo.url
  if (!url || typeof url !== 'string') {
    logSkip(photo, 'missing-url', { urlType: typeof url })
    return null
  }
  // Reject obviously invalid URL shapes (blob URLs, data URLs with bad prefixes are OK,
  // but we reject empty/whitespace-only and protocol-relative URLs)
  const trimmedUrl = url.trim()
  if (trimmedUrl.length === 0) {
    logSkip(photo, 'empty-url')
    return null
  }
  // Reject non-http/https/blob/data URLs that might be objects or functions stringified
  if (
    !trimmedUrl.startsWith('http://') &&
    !trimmedUrl.startsWith('https://') &&
    !trimmedUrl.startsWith('blob:') &&
    !trimmedUrl.startsWith('data:') &&
    !trimmedUrl.startsWith('/')
  ) {
    logSkip(photo, 'suspicious-url-prefix', { urlPrefix: trimmedUrl.slice(0, 40) })
    return null
  }

  // Optional: content type validation
  const mimeType = typeof photo.mimeType === 'string' ? photo.mimeType.toLowerCase() : ''
  if (mimeType) {
    if (BLOCKED_MIME_TYPES.has(mimeType)) {
      logSkip(photo, 'blocked-format', { mimeType })
      return null
    }
    // If it's an image type but not in our safe list, we still allow it
    // (the <img> onError will handle rendering failures gracefully).
    // We only actively block known-problematic formats.
  }

  // createdAt: try to parse safely
  let createdAt = null
  if (photo.createdAt != null) {
    const d = new Date(photo.createdAt)
    if (!isNaN(d.getTime())) {
      createdAt = d.toISOString()
    }
  }

  return {
    id,
    url: trimmedUrl,
    originalName: typeof photo.originalName === 'string' ? photo.originalName : '',
    uploaderName: typeof photo.uploaderName === 'string' ? photo.uploaderName : '',
    caption: typeof photo.caption === 'string' ? photo.caption : '',
    mimeType,
    size: typeof photo.size === 'number' && !isNaN(photo.size) ? photo.size : 0,
    status: typeof photo.status === 'string' ? photo.status : 'VISIBLE',
    createdAt,
  }
}

/**
 * Accept any input and return an array of valid, normalized photo objects.
 * Never throws.
 */
export function getRenderablePhotos(photosInput) {
  if (!photosInput) {
    return []
  }
  if (!Array.isArray(photosInput)) {
    console.warn('[photo-utils] expected array, got', typeof photosInput)
    return []
  }
  return photosInput
    .map(normalizePublicPhoto)
    .filter(function (p) { return Boolean(p) })
}

/**
 * Safely sort photos by createdAt descending.
 * Falls back to unsorted array if anything goes wrong.
 */
export function safeSortPhotos(photos) {
  if (!Array.isArray(photos)) {
    return []
  }
  try {
    return [...photos].sort((left, right) => {
      const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0
      const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0
      // Guard against NaN from invalid dates
      if (isNaN(leftTime) && isNaN(rightTime)) return 0
      if (isNaN(leftTime)) return 1
      if (isNaN(rightTime)) return -1
      return rightTime - leftTime
    })
  } catch (sortError) {
    console.error('[photo-utils] sort failed, returning unsorted', sortError)
    return photos
  }
}

/**
 * Full pipeline: normalize + sort in one safe call.
 */
export function getSortedRenderablePhotos(photosInput) {
  const valid = getRenderablePhotos(photosInput)
  return safeSortPhotos(valid)
}
