import { getPhotoBuffer } from '@/lib/server/download-utils'
import { getDisplayDerivative } from '@/lib/server/display-derivative'
import { getBrandedDerivative } from '@/lib/server/download-derivative'
import { PWM_DISPLAY_KIND, PWM_ORIGINAL_KIND } from '@/lib/server/photographer-watermark-derivative'

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

/**
 * Server-authoritative representation policy shared by every download path.
 *
 * STANDARD preserves the existing Free-event branding contract. Unbranded
 * Standard downloads use the deterministic EXIF-safe display derivative.
 * ORIGINAL returns the persisted source bytes only when explicitly entitled.
 *
 * Photographer watermark: when `watermark` (the event owner's active spec,
 * already null for the owner's own authenticated requests) is set, it takes
 * precedence over everything else — STANDARD is the watermarked display
 * derivative and ORIGINAL the full-resolution watermarked render. The
 * SnapRooms-branded and clean paths are unreachable in that branch.
 */
export async function resolveDownloadRepresentation({
  photo,
  requestedQuality,
  access,
  sourceLoader = getPhotoBuffer,
  standardResolver = getDisplayDerivative,
  brandedResolver = getBrandedDerivative,
  watermark = null,
  watermarkDisplayResolver = PWM_DISPLAY_KIND.resolve,
  watermarkOriginalResolver = PWM_ORIGINAL_KIND.resolve,
}) {
  if (!photo?.id || !photo?.url) throw new Error('Photo id and source URL are required')
  const quality = normalizeDownloadQuality(requestedQuality)

  if (watermark) {
    if (quality === DOWNLOAD_QUALITY_ORIGINAL && access?.canDownloadOriginal !== true) {
      throw new OriginalDownloadForbiddenError()
    }
    const resolver = quality === DOWNLOAD_QUALITY_ORIGINAL ? watermarkOriginalResolver : watermarkDisplayResolver
    return {
      quality,
      buffer: await resolver({ photoId: photo.id, spec: watermark, getSourceBuffer: () => sourceLoader(photo.url) }),
      contentType: 'image/jpeg',
      extension: '.jpg',
      representation: quality === DOWNLOAD_QUALITY_ORIGINAL ? 'pwm-original' : 'pwm-display',
    }
  }

  if (quality === DOWNLOAD_QUALITY_ORIGINAL) {
    if (access?.canDownloadOriginal !== true) throw new OriginalDownloadForbiddenError()
    return {
      quality,
      buffer: await sourceLoader(photo.url),
      contentType: photo.mimeType || 'application/octet-stream',
      extension: null,
      representation: 'source',
    }
  }

  const getSourceBuffer = () => sourceLoader(photo.url)
  // Fail-closed: unbranded Standard requires an EXPLICIT true. Missing/null
  // access, or an access object that simply never set hasUnbrandedDownloads,
  // must never grant unbranded Standard — it gets the branded wm-v2 path,
  // the same as an explicit false.
  if (access?.hasUnbrandedDownloads === true) {
    return {
      quality,
      buffer: await standardResolver({ photoId: photo.id, getSourceBuffer }),
      contentType: 'image/jpeg',
      extension: '.jpg',
      representation: 'display-v1',
    }
  }

  return {
    quality,
    buffer: await brandedResolver({ photoId: photo.id, getSourceBuffer }),
    contentType: 'image/jpeg',
    extension: '.jpg',
    representation: 'branded-wm',
  }
}
