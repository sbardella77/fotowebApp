import sharp from 'sharp'
import { readFile, access } from 'fs/promises'
import path from 'path'

const WATERMARK_CONFIG = {
  assetPath: path.join(process.cwd(), 'public', 'watermark', 'snaprooms-watermark.png'),
  fallbackText: 'SnapRooms',
  mode: 'brand', // 'grayscale' | 'brand'
  opacity: 0.30,
  maxWidthRatio: 0.22,
  minWidth: 60,
  maxWidth: 360,
  paddingRatio: 0.035,
  position: 'bottom-right',
}

/**
 * Identity of the branded-download output contract.
 *
 * Bump this whenever ANY input to the rendered bytes changes: badge asset,
 * opacity, placement/padding ratios, orientation handling, output format,
 * JPEG quality, or flatten background. A future derivative cache (STEP
 * 7.14b, not implemented here) will use it as part of its storage key, so a
 * change without a bump would serve stale bytes forever.
 */
export const WATERMARK_DERIVATIVE_VERSION = 'v1'

/**
 * The frozen output contract for single-photo branded downloads
 * (/api/download/photo). Deliberately OPT-IN: the gallery ZIP route and the
 * async gallery job call applyWatermark() with no options and must keep
 * their pre-existing preserve-the-input-container behavior. See STEP
 * 7.14a.0 §2/§3.
 */
export const BRANDED_DOWNLOAD_WATERMARK_OPTIONS = Object.freeze({
  outputFormat: 'jpeg',
  jpegQuality: 85,
  flattenBackground: '#ffffff',
  autoOrient: true,
})

// EXIF orientations that rotate the image 90°, so the visual (display)
// dimensions are the stored dimensions with the axes swapped.
const AXIS_SWAPPING_ORIENTATIONS = new Set([5, 6, 7, 8])

/**
 * Resolve the dimensions a viewer actually sees, honouring EXIF orientation.
 *
 * Watermark geometry (badge size, padding, placement) must be computed from
 * these — sizing from raw stored dimensions puts the badge in the wrong
 * corner at the wrong scale for any rotated phone photo.
 *
 * @param {{width?: number, height?: number, orientation?: number}} metadata
 * @returns {{width: number, height: number}}
 */
export function resolveDisplayDimensions(metadata) {
  const width = metadata?.width || 800
  const height = metadata?.height || 600
  if (AXIS_SWAPPING_ORIENTATIONS.has(metadata?.orientation)) {
    return { width: height, height: width }
  }
  return { width, height }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

async function assetExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

let cachedBadgeBuffer = null
let cachedBadgeWidth = null
let cachedBadgeHeight = null

async function getBadgeOriginal() {
  if (!cachedBadgeBuffer) {
    cachedBadgeBuffer = await readFile(WATERMARK_CONFIG.assetPath)
    const meta = await sharp(cachedBadgeBuffer).metadata()
    cachedBadgeWidth = meta.width
    cachedBadgeHeight = meta.height
  }
  return {
    buffer: cachedBadgeBuffer,
    width: cachedBadgeWidth,
    height: cachedBadgeHeight,
  }
}

async function applyOpacity(buffer, opacity) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * opacity)
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer()
}

function getBadgePipeline(sharpInstance) {
  if (WATERMARK_CONFIG.mode === 'grayscale') {
    return sharpInstance.grayscale()
  }
  // brand mode: keep original brand colour; softness comes from opacity only
  return sharpInstance
}

// Fully-prepared (resized + opacity-applied) badges, memoized because that
// work is a measured ~15ms constant per request regardless of photo size —
// 52% of total cost for a small photo (STEP 7.14a.0 §D).
//
// Keys are namespaced by fit mode ('w:' vs 'h:') so the two resize modes can
// never collide, and are derived from the CLAMPED target dimension, never
// from a raw source width. Target widths are clamped to
// [minWidth, maxWidth] = [60, 360], so the 'w:' keyspace is <= 301 entries;
// the 'h:' branch is rarer and bounded defensively by the cap below.
const preparedBadgeCache = new Map()
const PREPARED_BADGE_CACHE_MAX_ENTRIES = 512

async function getPreparedBadge(cacheKey, build) {
  const cached = preparedBadgeCache.get(cacheKey)
  if (cached) return cached

  const prepared = await build()
  // Hard bound: the keyspace is already clamped, but never let this grow
  // without limit if the clamp is ever loosened.
  if (preparedBadgeCache.size >= PREPARED_BADGE_CACHE_MAX_ENTRIES) {
    preparedBadgeCache.clear()
  }
  preparedBadgeCache.set(cacheKey, prepared)
  return prepared
}

/** Test-only helper: inspect/reset the memo without exporting the Map itself. */
export function __getPreparedBadgeCacheStats() {
  return { size: preparedBadgeCache.size, max: PREPARED_BADGE_CACHE_MAX_ENTRIES }
}
export function __resetPreparedBadgeCache() {
  preparedBadgeCache.clear()
}

async function buildTextWatermark(imageWidth, imageHeight) {
  // Fallback: render a simple text watermark when asset is missing
  const fontSize = clamp(Math.round(imageWidth * 0.04), 16, 48)
  const svg = `
    <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${imageWidth - 24}"
        y="${imageHeight - 24}"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="rgba(255,255,255,0.35)"
        text-anchor="end"
        dominant-baseline="ideographic"
      >${WATERMARK_CONFIG.fallbackText}</text>
    </svg>
  `
  return Buffer.from(svg)
}

/**
 * Apply a robust SnapRooms watermark to an image buffer.
 *
 * Uses the branded logo asset composited with sharp.
 * The badge is dynamically resized to fit the target image while
 * remaining clearly visible and never clipped.
 *
 * The original buffer is never mutated on disk/storage.
 *
 * @param {Buffer} imageBuffer - The original image buffer
 * @returns {Promise<Buffer>} - The watermarked image buffer
 */
export async function applyWatermark(imageBuffer, options = {}) {
  const {
    outputFormat = null,
    jpegQuality = BRANDED_DOWNLOAD_WATERMARK_OPTIONS.jpegQuality,
    flattenBackground = null,
    autoOrient = false,
  } = options

  const metadata = await sharp(imageBuffer).metadata()

  // Only opted-in callers get orientation-aware geometry. Default callers
  // (gallery ZIP, gallery job) keep their exact pre-existing behavior, which
  // sizes from raw stored dimensions.
  const { width, height } = autoOrient
    ? resolveDisplayDimensions(metadata)
    : { width: metadata.width || 800, height: metadata.height || 600 }

  const useAsset = await assetExists(WATERMARK_CONFIG.assetPath)
  const composites = []

  if (useAsset) {
    const badgeOriginal = await getBadgeOriginal()

    let targetWidth = clamp(Math.round(width * WATERMARK_CONFIG.maxWidthRatio), WATERMARK_CONFIG.minWidth, WATERMARK_CONFIG.maxWidth)
    const padding = Math.round(Math.max(width, height) * WATERMARK_CONFIG.paddingRatio)
    const maxAvailableWidth = width - padding * 2
    const maxAvailableHeight = height - padding * 2

    if (targetWidth > maxAvailableWidth) {
      targetWidth = maxAvailableWidth
    }

    const buildByWidth = async () => {
      const resized = await getBadgePipeline(
        sharp(badgeOriginal.buffer).resize(Math.round(targetWidth), null, {
          withoutEnlargement: false,
          fit: 'inside',
        })
      ).toBuffer()
      const meta = await sharp(resized).metadata()
      return { buffer: await applyOpacity(resized, WATERMARK_CONFIG.opacity), width: meta.width, height: meta.height }
    }

    let badge = await getPreparedBadge(`w:${Math.round(targetWidth)}`, buildByWidth)

    if (badge.height > maxAvailableHeight) {
      const constrainedHeight = Math.round(maxAvailableHeight)
      badge = await getPreparedBadge(`h:${constrainedHeight}`, async () => {
        const resized = await getBadgePipeline(
          sharp(badgeOriginal.buffer).resize(null, constrainedHeight, {
            withoutEnlargement: false,
            fit: 'inside',
          })
        ).toBuffer()
        const meta = await sharp(resized).metadata()
        return { buffer: await applyOpacity(resized, WATERMARK_CONFIG.opacity), width: meta.width, height: meta.height }
      })
    }

    composites.push({
      input: badge.buffer,
      top: Math.max(0, height - badge.height - padding),
      left: Math.max(0, width - badge.width - padding),
      blend: 'over',
    })
  } else {
    // Fallback: text watermark via SVG, sized to the same geometry.
    composites.push({ input: await buildTextWatermark(width, height), blend: 'over' })
  }

  let pipeline = sharp(imageBuffer)

  // Auto-orient BEFORE compositing so the badge lands in the correct visual
  // corner and the emitted pixels need no consumer-side rotation.
  if (autoOrient) {
    pipeline = pipeline.rotate()
  }

  pipeline = pipeline.composite(composites)

  // Alpha must be flattened explicitly before JPEG encoding; otherwise
  // transparent pixels become BLACK (verified in STEP 7.14a.0 §C).
  if (flattenBackground) {
    pipeline = pipeline.flatten({ background: flattenBackground })
  }

  if (outputFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: jpegQuality })
  }

  return pipeline.toBuffer()
}
