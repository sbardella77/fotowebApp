import { getPhotoBuffer } from '@/lib/server/download-utils'
import { getDisplayDerivative } from '@/lib/server/display-derivative'

export const DOWNLOAD_QUALITY_STANDARD = 'standard'
export const DOWNLOAD_QUALITY_ORIGINAL = 'original'

export class OriginalDownloadForbiddenError extends Error {
  constructor() {
    super('Original quality is not available for this event')
    this.name = 'OriginalDownloadForbiddenError'
  }
}

export function normalizeDownloadQuality(value) {
  return value === DOWNLOAD_QUALITY_ORIGINAL
    ? DOWNLOAD_QUALITY_ORIGINAL
    : DOWNLOAD_QUALITY_STANDARD
}

/**
 * Server-authoritative representation policy shared by single-photo and ZIP paths.
 *
 * STANDARD is always the deterministic, EXIF-safe display derivative.
 * ORIGINAL is always the persisted source bytes and requires canDownloadOriginal.
 * There is deliberately no silent original->standard fallback: callers must expose
 * an entitlement error rather than making the API contract ambiguous.
 */
export async function resolveDownloadRepresentation({ photo, requestedQuality, access }) {
  if (!photo?.id || !photo?.url) throw new Error('Photo id and source URL are required')

  const quality = normalizeDownloadQuality(requestedQuality)

  if (quality === DOWNLOAD_QUALITY_ORIGINAL) {
    if (!access?.canDownloadOriginal) throw new OriginalDownloadForbiddenError()
    return {
      quality,
      buffer: await getPhotoBuffer(photo.url),
      contentType: photo.mimeType || 'application/octet-stream',
      extension: null,
      representation: 'source',
    }
  }

  return {
    quality,
    buffer: await getDisplayDerivative({
      photoId: photo.id,
      getSourceBuffer: () => getPhotoBuffer(photo.url),
    }),
    contentType: 'image/jpeg',
    extension: '.jpg',
    representation: 'display-v1',
  }
}
