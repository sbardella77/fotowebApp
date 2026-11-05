import { createWatermarkVariantKind } from '@/lib/server/download-derivative'
import { applyPhotographerWatermark } from '@/lib/server/photographer-watermark-render'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { serializeProviderError } from '@/lib/server/safe-log'

/**
 * Photographer-watermark derivatives (pwm).
 *
 * `display` replaces display-v1 as what guests VIEW (same 1600px cap and
 * quality as display-derivative.js) and is the standard-quality download.
 * `original` is the full-resolution, watermarked original-quality download;
 * it is produced lazily on download only.
 *
 * Bump PWM_DERIVATIVE_VERSION when any pipeline constant below changes. Spec
 * changes (logo, text, position, opacity, size, renderer, font) are covered
 * by the revision in each path.
 */
export const PWM_DERIVATIVE_VERSION = 'v1'
export const PWM_DISPLAY_MAX_LONG_EDGE = 1600
export const PWM_DISPLAY_QUALITY = 82
export const PWM_ORIGINAL_QUALITY = 92

export const PWM_DISPLAY_KIND = createWatermarkVariantKind({
  version: PWM_DERIVATIVE_VERSION,
  variant: 'display',
  lockNamespace: 'pwm-transform',
  transform: (sourceBuffer, spec) => applyPhotographerWatermark(sourceBuffer, spec, { maxLongEdge: PWM_DISPLAY_MAX_LONG_EDGE, jpegQuality: PWM_DISPLAY_QUALITY }),
})

export const PWM_ORIGINAL_KIND = createWatermarkVariantKind({
  version: PWM_DERIVATIVE_VERSION,
  variant: 'original',
  lockNamespace: 'pwm-transform',
  transform: (sourceBuffer, spec) => applyPhotographerWatermark(sourceBuffer, spec, { maxLongEdge: null, jpegQuality: PWM_ORIGINAL_QUALITY }),
})

export function buildPwmDisplayPath(photoId, spec) {
  return PWM_DISPLAY_KIND.buildPath(photoId, spec)
}

/** Every pwm object of one photo lives under this prefix. */
export function buildPwmPhotoPrefix(photoId) {
  return `derivatives/pwm-${PWM_DERIVATIVE_VERSION}/${photoId}/`
}

/**
 * Ensure the watermarked display derivative exists for the spec's revision
 * and record it on Photo.watermarkDisplayRevision.
 *
 * Best-effort, mirroring ensurePhotoDisplayDerivativeStatus: never throws, so
 * an upload or a regeneration batch item never fails because of it. A photo
 * whose column does not match the current revision is still never shown
 * clean — guest-photo-url.js routes it through the lazy media route instead.
 *
 * @returns {Promise<{ok: boolean, created: boolean}>}
 */
export async function ensurePhotoWatermarkDisplay({ prisma, photo, spec, operation, sourceBuffer, getSourceBuffer, ensure = PWM_DISPLAY_KIND.ensure }) {
  if (!spec || photo?.mediaType === 'VIDEO') return { ok: false, created: false }
  try {
    const result = await ensure({
      photoId: photo.id,
      spec,
      getSourceBuffer: getSourceBuffer || (sourceBuffer ? async () => sourceBuffer : () => getPhotoBuffer(photo.url)),
    })
    await prisma?.photo?.updateMany?.({
      where: { id: photo.id },
      data: { watermarkDisplayRevision: spec.revision },
    })?.catch((updateError) => {
      console.warn(`[${operation}] Failed to record watermark display revision for photo:`, photo.id, serializeProviderError('db', 'record_watermark_display_revision', updateError))
    })
    return { ok: true, created: result.created }
  } catch (error) {
    console.warn(`[${operation}] Watermark display derivative failed for photo:`, photo.id, serializeProviderError('blob', 'ensure_photo_watermark_display', error))
    return { ok: false, created: false }
  }
}
