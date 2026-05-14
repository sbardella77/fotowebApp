import sharp from 'sharp'

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

/**
 * Escape XML special characters to keep the SVG valid.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Create a full-size SVG watermark buffer to be composited with sharp.
 *
 * Uses only inline SVG attributes (no CSS, no classes) for maximum
 * compatibility with librsvg — the SVG renderer used by sharp.
 *
 * @param {Object} params
 * @param {number} params.imageWidth
 * @param {number} params.imageHeight
 * @param {string} [params.text="snaprooms.app by sbardella.de"]
 * @returns {Buffer}
 */
export function createWatermarkSvg({
  imageWidth,
  imageHeight,
  text = 'snaprooms.app by sbardella.de',
}) {
  const safeText = escapeXml(text)
  const fontSize = clamp(Math.round(imageWidth * 0.018), 24, 42)
  const paddingX = fontSize * 0.75
  const paddingY = fontSize * 0.5
  const radius = fontSize * 0.45
  const margin = 28

  // Estimate text width using an average glyph advance of ~0.58em
  const textWidth = text.length * fontSize * 0.58
  const boxWidth = Math.round(textWidth + paddingX * 2)
  const boxHeight = Math.round(fontSize + paddingY * 2)

  const x = imageWidth - boxWidth - margin
  const y = imageHeight - boxHeight - margin

  // Text origin is positioned at the bottom-right of the padding area
  const textX = x + boxWidth - paddingX
  const textY = y + boxHeight - paddingY

  const shadowOffset = Math.max(1, Math.round(fontSize * 0.06))

  const svg = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0.58)" />
    <text x="${textX + shadowOffset}" y="${textY + shadowOffset}" text-anchor="end" font-family="Arial, Helvetica, &quot;DejaVu Sans&quot;, sans-serif" font-size="${fontSize}px" font-weight="600" fill="rgba(0,0,0,0.45)">${safeText}</text>
    <text x="${textX}" y="${textY}" text-anchor="end" font-family="Arial, Helvetica, &quot;DejaVu Sans&quot;, sans-serif" font-size="${fontSize}px" font-weight="600" fill="rgba(255,255,255,0.96)">${safeText}</text>
  </svg>`

  return Buffer.from(svg)
}

/**
 * Apply a robust SnapRooms watermark to an image buffer.
 *
 * Uses a server-side SVG overlay composited with sharp.
 * The original buffer is never mutated on disk/storage.
 *
 * @param {Buffer} imageBuffer - The original image buffer
 * @returns {Promise<Buffer>} - The watermarked image buffer
 */
export async function applyWatermark(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width || 800
  const height = metadata.height || 600

  const svgBuffer = createWatermarkSvg({
    imageWidth: width,
    imageHeight: height,
  })

  return sharp(imageBuffer)
    .composite([
      {
        input: svgBuffer,
        top: 0,
        left: 0,
        blend: 'over',
      },
    ])
    .toBuffer()
}
