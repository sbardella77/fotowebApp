import sharp from 'sharp'
import path from 'path'
import { createHash } from 'crypto'
import opentype from 'opentype.js'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { applyOpacity, clamp, resolveDisplayDimensions } from '@/lib/server/watermark'

/**
 * Photographer watermark renderer.
 *
 * Text is rendered as glyph OUTLINES (opentype.js → SVG path data), never as
 * SVG <text> or Pango markup: the user's string never reaches a markup
 * parser, so there is nothing to inject, and no system fonts/fontconfig are
 * needed on Vercel. The SVG contains only numeric path data.
 *
 * Every output is re-encoded JPEG with EXIF orientation applied and all
 * metadata (including GPS) dropped — the same EXIF-safe contract as the
 * display derivative.
 */

export const WATERMARK_FONT_PATH = path.join(process.cwd(), 'public', 'watermark', 'fonts', 'NotoSans-Regular-latin.ttf')
const PADDING_RATIO = 0.035 // same as the SnapRooms badge (watermark.js)
const MAX_OVERLAY_HEIGHT_RATIO = 0.4
const MIN_OVERLAY_WIDTH = 24
const INPUT_PIXEL_LIMIT = 100_000_000
const FLATTEN_BACKGROUND = '#ffffff'

let cachedFont = null

export function getWatermarkFont() {
  if (!cachedFont) cachedFont = opentype.loadSync(WATERMARK_FONT_PATH)
  return cachedFont
}

/** True when the bundled font has a real glyph for this character. */
export function fontHasGlyph(char) {
  return getWatermarkFont().charToGlyphIndex(char) > 0
}

// --- logo bytes, memoized by content hash -------------------------------

const logoCache = new Map()
const LOGO_CACHE_MAX_ENTRIES = 16

async function loadLogo(spec) {
  const cached = logoCache.get(spec.logoSha256)
  if (cached) return cached
  const buffer = await getPhotoBuffer(spec.logoUrl)
  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== spec.logoSha256) {
    // The revision hashes logoSha256; rendering other bytes under it would
    // poison every derivative cached for this revision.
    throw new Error('Watermark logo bytes do not match the configured hash')
  }
  if (logoCache.size >= LOGO_CACHE_MAX_ENTRIES) logoCache.clear()
  logoCache.set(spec.logoSha256, buffer)
  return buffer
}

// --- overlay geometry ----------------------------------------------------

/**
 * Overlay box and placement for an image of width × height.
 * Size is a percentage of the image WIDTH, bounded so the overlay always
 * fits inside the padded area and never covers more than 40% of the height.
 */
export function computeOverlayBox(width, height, sizePercent) {
  const padding = Math.round(Math.max(width, height) * PADDING_RATIO)
  const maxWidth = Math.max(1, width - padding * 2)
  const maxHeight = Math.max(1, Math.min(height - padding * 2, Math.round(height * MAX_OVERLAY_HEIGHT_RATIO)))
  const targetWidth = clamp(Math.round((width * sizePercent) / 100), Math.min(MIN_OVERLAY_WIDTH, maxWidth), maxWidth)
  return { padding, targetWidth, maxHeight }
}

export function computeOverlayPosition({ width, height, overlayWidth, overlayHeight, padding, position }) {
  const right = Math.max(0, width - overlayWidth - padding)
  const bottom = Math.max(0, height - overlayHeight - padding)
  switch (position) {
    case 'top-left':
      return { left: padding, top: padding }
    case 'top-right':
      return { left: right, top: padding }
    case 'bottom-left':
      return { left: padding, top: bottom }
    case 'center':
      return { left: Math.max(0, Math.round((width - overlayWidth) / 2)), top: Math.max(0, Math.round((height - overlayHeight) / 2)) }
    case 'bottom-right':
    default:
      return { left: right, top: bottom }
  }
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
}

/** SVG for a text overlay — numeric path data only, no user string. */
export function buildTextOverlaySvg(text, targetWidth, maxHeight, opacity) {
  const font = getWatermarkFont()
  const reference = font.getPath(text, 0, 0, 100).getBoundingBox()
  const referenceWidth = Math.max(1, reference.x2 - reference.x1)
  const referenceHeight = Math.max(1, reference.y2 - reference.y1)
  const scale = Math.min(targetWidth / referenceWidth, maxHeight / referenceHeight)
  const fontSize = 100 * scale
  const shadow = Math.max(1, fontSize * 0.04)
  const width = Math.max(1, Math.ceil(referenceWidth * scale + shadow + 2))
  const height = Math.max(1, Math.ceil(referenceHeight * scale + shadow + 2))
  const d = font.getPath(text, 1 - reference.x1 * scale, 1 - reference.y1 * scale, fontSize).toPathData(2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<g opacity="${formatNumber(opacity)}">`
    + `<path d="${d}" fill="#000000" fill-opacity="0.45" transform="translate(${formatNumber(shadow)},${formatNumber(shadow)})"/>`
    + `<path d="${d}" fill="#ffffff"/>`
    + '</g></svg>'
  return { svg: Buffer.from(svg), width, height }
}

// Prepared overlays (sized + opacity applied), keyed by spec identity and
// target image dimensions. Bounded like the SnapRooms badge cache.
const overlayCache = new Map()
const OVERLAY_CACHE_MAX_ENTRIES = 256

function specKey(spec) {
  return JSON.stringify([spec.type, spec.text, spec.logoSha256, spec.position, spec.opacity, spec.sizePercent])
}

/** Test-only helper. */
export function __resetPhotographerWatermarkCaches() {
  overlayCache.clear()
  logoCache.clear()
}

async function buildOverlay(spec, width, height) {
  const cacheKey = `${specKey(spec)}:${width}x${height}`
  const cached = overlayCache.get(cacheKey)
  if (cached) return cached

  const { padding, targetWidth, maxHeight } = computeOverlayBox(width, height, spec.sizePercent)
  let overlay
  if (spec.type === 'logo') {
    const logo = await loadLogo(spec)
    const resized = await sharp(logo)
      .resize(targetWidth, maxHeight, { fit: 'inside', withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true })
    overlay = {
      buffer: await applyOpacity(resized.data, spec.opacity),
      width: resized.info.width,
      height: resized.info.height,
    }
  } else {
    const text = buildTextOverlaySvg(spec.text, targetWidth, maxHeight, spec.opacity)
    const rendered = await sharp(text.svg).png().toBuffer({ resolveWithObject: true })
    overlay = { buffer: rendered.data, width: rendered.info.width, height: rendered.info.height }
  }

  const prepared = {
    ...overlay,
    ...computeOverlayPosition({ width, height, overlayWidth: overlay.width, overlayHeight: overlay.height, padding, position: spec.position }),
  }
  if (overlayCache.size >= OVERLAY_CACHE_MAX_ENTRIES) overlayCache.clear()
  overlayCache.set(cacheKey, prepared)
  return prepared
}

/**
 * Render a photo with the photographer watermark.
 *
 * @param {Buffer} source original image bytes
 * @param {object} spec from resolveActiveWatermark / buildWatermarkSpec
 * @param {{ maxLongEdge: number|null, jpegQuality: number }} options
 *   maxLongEdge null keeps the full resolution (original-quality download).
 * @returns {Promise<Buffer>} JPEG, orientation applied, no metadata
 */
export async function applyPhotographerWatermark(source, spec, { maxLongEdge, jpegQuality }) {
  let base
  let width
  let height

  if (maxLongEdge) {
    // Resize first, then read the exact output size from the raw buffer:
    // overlay geometry must match the real pixels, not a predicted size.
    const raw = await sharp(source, { limitInputPixels: INPUT_PIXEL_LIMIT })
      .rotate()
      .resize(maxLongEdge, maxLongEdge, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: FLATTEN_BACKGROUND })
      .raw()
      .toBuffer({ resolveWithObject: true })
    width = raw.info.width
    height = raw.info.height
    base = sharp(raw.data, { raw: { width, height, channels: raw.info.channels } })
  } else {
    // Full resolution: avoid a raw round-trip of a 50MP image. rotate()
    // applies EXIF orientation, so the visual size is the axis-swapped one.
    const metadata = await sharp(source, { limitInputPixels: INPUT_PIXEL_LIMIT }).metadata()
    ;({ width, height } = resolveDisplayDimensions(metadata))
    base = sharp(source, { limitInputPixels: INPUT_PIXEL_LIMIT })
      .rotate()
      .flatten({ background: FLATTEN_BACKGROUND })
  }

  const overlay = await buildOverlay(spec, width, height)
  return base
    .composite([{ input: overlay.buffer, left: overlay.left, top: overlay.top, blend: 'over' }])
    .jpeg({ quality: jpegQuality })
    .toBuffer()
}

const PREVIEW_SAMPLES = Object.freeze({
  landscape: { width: 1200, height: 800, top: '#7ea1c4', bottom: '#d9c7a7' },
  portrait: { width: 800, height: 1200, top: '#8fae8b', bottom: '#e3d3c0' },
})

/**
 * Preview of a (possibly unsaved) spec on a neutral gradient sample.
 * Uses the same renderer as delivery, so the preview matches what guests get.
 */
export async function renderWatermarkPreview(spec, { sample = 'landscape' } = {}) {
  const { width, height, top, bottom } = PREVIEW_SAMPLES[sample] || PREVIEW_SAMPLES.landscape
  const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`
  const source = await sharp(Buffer.from(gradient)).jpeg({ quality: 90 }).toBuffer()
  return applyPhotographerWatermark(source, spec, { maxLongEdge: 900, jpegQuality: 85 })
}
