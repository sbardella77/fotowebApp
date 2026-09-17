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
  return value === DOWNLOAD_QUALITY_ORIGINAL ? DOWNLOAD_QUALITY_ORIGINAL : DOWNLOAD_QUALITY_STANDARD
}

/** Server-authoritative representation policy shared by every download path. */
export async function resolveDownloadRepresentation({
  photo,
  requestedQuality,
  access,
  sourceLoader = getPhotoBuffer,
  standardResolver = getDisplayDerivative,
}) {
  if (!photo?.id || !photo?.url) throw new Error('Photo id and source URL are required')
  const quality = normalizeDownloadQuality(requestedQuality)

  if (quality === DOWNLOAD_QUALITY_ORIGINAL) {
    if (!access?.canDownloadOriginal) throw new OriginalDownloadForbiddenError()
    return {
      quality,
      buffer: await sourceLoader(photo.url),
      contentType: photo.mimeType || 'application/octet-stream',
      extension: null,
      representation: 'source',
    }
  }

  return {
    quality,
    buffer: await standardResolver({
      photoId: photo.id,
      getSourceBuffer: () => sourceLoader(photo.url),
    }),
    contentType: 'image/jpeg',
    extension: '.jpg',
    representation: 'display-v1',
  }
}
