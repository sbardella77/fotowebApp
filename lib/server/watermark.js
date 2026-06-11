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
export async function applyWatermark(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 800
  const height = metadata.height || 600

  const useAsset = await assetExists(WATERMARK_CONFIG.assetPath)
  let watermarkInput

  if (useAsset) {
    const badgeOriginal = await getBadgeOriginal()

    let targetWidth = clamp(Math.round(width * WATERMARK_CONFIG.maxWidthRatio), WATERMARK_CONFIG.minWidth, WATERMARK_CONFIG.maxWidth)
    const padding = Math.round(Math.max(width, height) * WATERMARK_CONFIG.paddingRatio)
    const maxAvailableWidth = width - padding * 2
    const maxAvailableHeight = height - padding * 2

    if (targetWidth > maxAvailableWidth) {
      targetWidth = maxAvailableWidth
    }

    let resizedBadge = await getBadgePipeline(
      sharp(badgeOriginal.buffer).resize(Math.round(targetWidth), null, {
        withoutEnlargement: false,
        fit: 'inside',
      })
    ).toBuffer()

    let badgeMeta = await sharp(resizedBadge).metadata()
    if (badgeMeta.height > maxAvailableHeight) {
      const constrainedHeight = maxAvailableHeight
      resizedBadge = await getBadgePipeline(
        sharp(badgeOriginal.buffer).resize(null, Math.round(constrainedHeight), {
          withoutEnlargement: false,
          fit: 'inside',
        })
      ).toBuffer()
      badgeMeta = await sharp(resizedBadge).metadata()
    }

    watermarkInput = await applyOpacity(resizedBadge, WATERMARK_CONFIG.opacity)
    const badgeW = badgeMeta.width
    const badgeH = badgeMeta.height

    const left = Math.max(0, width - badgeW - padding)
    const top = Math.max(0, height - badgeH - padding)

    return sharp(imageBuffer)
      .composite([
        {
          input: watermarkInput,
          top,
          left,
          blend: 'over',
        },
      ])
      .toBuffer()
  }

  // Fallback: text watermark via SVG
  watermarkInput = await buildTextWatermark(width, height)
  return sharp(imageBuffer)
    .composite([
      {
        input: watermarkInput,
        blend: 'over',
      },
    ])
    .toBuffer()
}
