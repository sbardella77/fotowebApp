import sharp from 'sharp'
import { readFile } from 'fs/promises'
import path from 'path'

const BADGE_PATH = path.join(process.cwd(), 'public', 'brand', 'watermark-badge.png')

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

let cachedBadgeBuffer = null
let cachedBadgeWidth = null
let cachedBadgeHeight = null

async function getBadgeOriginal() {
  if (!cachedBadgeBuffer) {
    cachedBadgeBuffer = await readFile(BADGE_PATH)
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

/**
 * Apply a robust SnapRooms watermark to an image buffer.
 *
 * Uses a pre-rendered PNG badge composited with sharp.
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

  const badgeOriginal = await getBadgeOriginal()

  // Target width: ~26% of image width, clamped between 220px and 560px
  let targetWidth = clamp(Math.round(width * 0.26), 220, 560)

  const margin = 28
  const maxAvailableWidth = width - margin * 2
  const maxAvailableHeight = height - margin * 2

  // Ensure the badge never exceeds the image dimensions
  if (targetWidth > maxAvailableWidth) {
    targetWidth = maxAvailableWidth
  }

  // Resize badge maintaining aspect ratio
  let resizedBadge = await sharp(badgeOriginal.buffer)
    .resize(Math.round(targetWidth), null, {
      withoutEnlargement: false,
      fit: 'inside',
    })
    .toBuffer()

  // Verify resized dimensions and re-constrain height if needed
  let badgeMeta = await sharp(resizedBadge).metadata()
  if (badgeMeta.height > maxAvailableHeight) {
    const constrainedHeight = maxAvailableHeight
    resizedBadge = await sharp(badgeOriginal.buffer)
      .resize(null, Math.round(constrainedHeight), {
        withoutEnlargement: false,
        fit: 'inside',
      })
      .toBuffer()
    badgeMeta = await sharp(resizedBadge).metadata()
  }

  const badgeW = badgeMeta.width
  const badgeH = badgeMeta.height

  const left = Math.max(0, width - badgeW - margin)
  const top = Math.max(0, height - badgeH - margin)

  return sharp(imageBuffer)
    .composite([
      {
        input: resizedBadge,
        top,
        left,
        blend: 'over',
      },
    ])
    .toBuffer()
}
