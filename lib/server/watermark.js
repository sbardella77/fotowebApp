import sharp from 'sharp'

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

/**
 * Create a full-size SVG watermark buffer to be composited with sharp.
 *
 * The watermark is rendered as a pill/badge at the bottom-right corner
 * with a dark semi-transparent background and bright text.
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
  const fontSize = clamp(Math.round(imageWidth * 0.018), 22, 40)
  const paddingX = fontSize * 0.75
  const paddingY = fontSize * 0.45
  const radius = fontSize * 0.45
  const marginRight = 28
  const marginBottom = 28

  // Estimate text width using an average glyph advance of ~0.58em
  const textWidth = text.length * fontSize * 0.58
  const boxWidth = Math.round(textWidth + paddingX * 2)
  const boxHeight = Math.round(fontSize + paddingY * 2)

  const x = imageWidth - boxWidth - marginRight
  const y = imageHeight - boxHeight - marginBottom

  // Vertical centre compensation for text baseline
  const textY = Math.round(y + boxHeight / 2 + fontSize * 0.35)

  const svg = `<svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .wm-text {
          font-family: "DejaVu Sans", "Arial", "Helvetica", sans-serif;
          font-size: ${fontSize}px;
          font-weight: 600;
          fill: rgba(255,255,255,0.96);
        }
      </style>
    </defs>
    <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${radius}" ry="${radius}" fill="rgba(0,0,0,0.58)" />
    <text x="${x + boxWidth / 2}" y="${textY}" text-anchor="middle" class="wm-text">${text}</text>
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
