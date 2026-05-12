import sharp from 'sharp'

/**
 * Apply a subtle SnapRooms watermark to an image buffer.
 * The watermark is positioned at the bottom-right corner.
 * It uses an SVG overlay for crisp text rendering at any size.
 *
 * @param {Buffer} imageBuffer - The original image buffer
 * @returns {Promise<Buffer>} - The watermarked image buffer
 */
export async function applyWatermark(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 800
  const height = metadata.height || 600

  // Watermark dimensions: 25% of image width, 8% of image height
  const watermarkWidth = Math.round(width * 0.25)
  const watermarkHeight = Math.round(height * 0.08)

  // Font size proportional to watermark height, with min/max bounds
  const fontSize = Math.max(10, Math.min(48, Math.round(watermarkHeight * 0.45)))

  // Padding from edges (scales with image size)
  const paddingX = Math.round(watermarkWidth * 0.15)
  const paddingY = Math.round(watermarkHeight * 0.2)

  // SVG watermark with shadow + main text for contrast on any background
  const svg = `<svg width="${watermarkWidth}" height="${watermarkHeight}" xmlns="http://www.w3.org/2000/svg">
    <!-- Shadow text (offset by 1px, semi-transparent black) -->
    <text
      x="${watermarkWidth - paddingX + 1}"
      y="${watermarkHeight - paddingY + 1}"
      text-anchor="end"
      dominant-baseline="auto"
      font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="${fontSize}"
      font-weight="600"
      fill="black"
      fill-opacity="0.35"
      style="letter-spacing: 0.5px;"
    >SnapRooms</text>
    <!-- Main text (white, semi-transparent) -->
    <text
      x="${watermarkWidth - paddingX}"
      y="${watermarkHeight - paddingY}"
      text-anchor="end"
      dominant-baseline="auto"
      font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="${fontSize}"
      font-weight="600"
      fill="white"
      fill-opacity="0.72"
      style="letter-spacing: 0.5px;"
    >SnapRooms</text>
  </svg>`

  const watermarkBuffer = Buffer.from(svg)

  return sharp(imageBuffer)
    .composite([
      {
        input: watermarkBuffer,
        gravity: 'southeast',
        blend: 'over',
      },
    ])
    .toBuffer()
}
