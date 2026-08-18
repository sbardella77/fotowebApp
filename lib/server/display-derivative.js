import sharp from 'sharp'
import { createDerivativeKind } from '@/lib/server/download-derivative'

/**
 * Free-guest display derivative (STEP 7.15c).
 *
 * A public, UNWATERMARKED, reduced-resolution rendition of a room photo,
 * intended as the only representation a Free guest's browser ever receives.
 * It is deliberately NOT the branded download artifact: `wm-v1` stays the
 * Free *download*, this is the Free *viewing* representation.
 *
 * The long-edge cap is the monetization boundary, not a quality preference.
 * Once the browser holds full-resolution bytes, nothing can stop the user
 * saving them — so the only enforceable line is never sending them. Product
 * copy sells "Original quality — full resolution as uploaded" as the paid
 * capability, and this cap is what makes that claim true.
 *
 * This module owns the pathname and the object bytes only. It deliberately
 * does NOT derive a public URL: constructing the public-store base URL is
 * owned by the later Guest DTO / display cutover step, so that the decision
 * about what the browser is told lives in exactly one place.
 *
 * Dormant by design in this step — nothing in the product calls it yet.
 */

/**
 * Identity of the display output contract.
 *
 * Bump this whenever ANY input to the rendered bytes changes: max edge,
 * quality, format, orientation handling, or flatten background. Path and
 * lock key both derive from it, so a change without a bump would serve stale
 * bytes forever.
 */
export const DISPLAY_DERIVATIVE_VERSION = 'v1'

export const DISPLAY_MAX_LONG_EDGE = 1600
export const DISPLAY_FORMAT = 'jpeg'
export const DISPLAY_QUALITY = 82
export const DISPLAY_BACKGROUND = '#ffffff'
export const DISPLAY_CACHE_CONTROL_MAX_AGE = 31_536_000 // 1 year

/** The frozen output contract, grouped for callers that want to assert on it. */
export const DISPLAY_TRANSFORM_CONFIG = Object.freeze({
  maxLongEdge: DISPLAY_MAX_LONG_EDGE,
  format: DISPLAY_FORMAT,
  quality: DISPLAY_QUALITY,
  background: DISPLAY_BACKGROUND,
})

/**
 * Produce the display rendition.
 *
 * Order is load-bearing:
 *   1. `.rotate()`  — apply EXIF orientation. Sharp strips metadata on
 *      output, so without this a rotated phone photo is baked in sideways
 *      with no orientation tag left to correct it.
 *   2. `.resize(..., { fit: 'inside', withoutEnlargement: true })` — caps the
 *      LONG edge whatever the aspect, preserves framing (no crop), and never
 *      enlarges a source that is already smaller than the cap.
 *   3. `.flatten({ background })` — transparent pixels become white. Without
 *      it, JPEG encoding renders alpha as BLACK.
 *   4. `.jpeg({ quality })` — explicit; never inherit Sharp's default.
 *
 * Animated GIFs collapse to their first frame: `animated: true` is
 * deliberately not passed. This is an intentional contract, not an
 * oversight — animation is a rare input here and preserving it would cost
 * far more for a representation that exists to be small.
 *
 * @param {Buffer} sourceBuffer
 * @returns {Promise<Buffer>} display JPEG bytes
 */
export async function transformDisplayImage(sourceBuffer) {
  return sharp(sourceBuffer)
    .rotate()
    .resize(DISPLAY_MAX_LONG_EDGE, DISPLAY_MAX_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: DISPLAY_BACKGROUND })
    .jpeg({ quality: DISPLAY_QUALITY })
    .toBuffer()
}

/**
 * Display derivative kind — shares the branded derivative's distributed
 * single-flight, storage-error semantics and put-race handling, so the
 * "never transform without the lock" guarantee is inherited structurally
 * rather than reimplemented.
 */
export const DISPLAY_DERIVATIVE_KIND = createDerivativeKind({
  version: DISPLAY_DERIVATIVE_VERSION,
  pathPrefix: 'display',
  lockNamespace: 'display-photo-transform',
  transform: transformDisplayImage,
  contentType: 'image/jpeg',
  extension: '.jpg',
  cacheControlMaxAge: DISPLAY_CACHE_CONTROL_MAX_AGE,
})

/** Deterministic, version-scoped, PII-free storage path. Uses the opaque photo id only. */
export function buildDisplayDerivativePath(photoId) {
  return DISPLAY_DERIVATIVE_KIND.buildPath(photoId)
}

/** One lock per display version, namespaced apart from the branded kind. */
export function buildDisplayTransformLockKey(photoId) {
  return DISPLAY_DERIVATIVE_KIND.buildLockKey(photoId)
}

/**
 * Resolve the display JPEG for a photo, transforming at most once.
 *
 * @param {object} params
 * @param {string} params.photoId
 * @param {() => Promise<Buffer>} params.getSourceBuffer  fetches the original image
 * @param {() => void} [params.onTransform]               test hook, fired per real transform
 * @param {() => number} [params.now]                     injectable clock for deadline tests
 * @returns {Promise<Buffer>} display JPEG bytes
 */
export async function getDisplayDerivative({ photoId, getSourceBuffer, onTransform, now = Date.now }) {
  return DISPLAY_DERIVATIVE_KIND.resolve({ photoId, getSourceBuffer, onTransform, now })
}

/**
 * Ensure the display JPEG exists for a photo, without ever returning or
 * fetching its bytes (STEP 7.15e).
 *
 * Shares every probe/lock/waiter/single-flight/put-race guarantee with
 * `getDisplayDerivative` — see `createDerivativeKind` in
 * download-derivative.js. The only difference is the return shape: a cache
 * HIT costs one Blob `head` and nothing else (no `getSourceBuffer`, no
 * Sharp, no derivative download), which is what makes this safe to call
 * eagerly on every photo write and moderation transition without turning
 * ordinary traffic into a derivative-bytes download storm.
 *
 * @param {object} params
 * @param {string} params.photoId
 * @param {() => Promise<Buffer>} params.getSourceBuffer  fetches the original image; not called on a HIT
 * @param {() => void} [params.onTransform]               test hook, fired per real transform
 * @param {() => number} [params.now]                     injectable clock for deadline tests
 * @returns {Promise<{created: boolean}>} `created` is true only when THIS call's transform+put produced the object
 */
export async function ensureDisplayDerivative({ photoId, getSourceBuffer, onTransform, now = Date.now }) {
  return DISPLAY_DERIVATIVE_KIND.ensure({ photoId, getSourceBuffer, onTransform, now })
}
