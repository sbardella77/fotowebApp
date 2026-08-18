import sharp from 'sharp'
import { ALLOWED_IMAGE_MIME_TYPES } from '@/lib/server/schemas'

/**
 * ROOM_PHOTO source-integrity validation (STEP 7.15g).
 *
 * Proves that an already-fetched buffer is a genuinely decodable image of an
 * allowed format, not merely bytes whose declared/provider-reported MIME
 * happens to say so. Metadata parsing alone is NOT sufficient: STEP
 * 7.15f.3-b proved real corrupt PNGs pass `sharp().metadata()` (valid
 * header) while their pixel stream cannot actually be decoded. `.stats()`
 * forces a real pixel decode without materializing a raw buffer back into
 * JS memory.
 *
 * Pure function: no DB, no Blob, no network, no filesystem, no logging.
 * Every exception here is about THIS buffer's content — fetch/infrastructure
 * failures are the caller's concern, classified separately as
 * IMAGE_VALIDATION_UNAVAILABLE.
 */

/** Bounds pixel-decode memory. Not a product limit — see STEP 7.15f.3-c §26. */
export const MAX_ROOM_PHOTO_PIXELS = 50_000_000

export class PhotoSourceValidationError extends Error {
  constructor(code) {
    super(`PhotoSourceValidationError: ${code}`)
    this.name = 'PhotoSourceValidationError'
    this.code = code
  }
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const GIF87_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]

function hasMagic(buffer, magic) {
  if (buffer.length < magic.length) return false
  for (let i = 0; i < magic.length; i += 1) {
    if (buffer[i] !== magic[i]) return false
  }
  return true
}

function isWebp(buffer) {
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
}

/**
 * Cheap prefilter only — identifies the format family from magic bytes so
 * obviously non-image content (text, HTML, JSON) is rejected before ever
 * invoking Sharp. NOT sufficient proof of validity by itself: never derives
 * format from declared MIME/filename/extension, and a real pixel decode
 * still follows.
 */
function detectMagicMimeType(buffer) {
  if (hasMagic(buffer, JPEG_MAGIC)) return 'image/jpeg'
  if (hasMagic(buffer, PNG_MAGIC)) return 'image/png'
  if (hasMagic(buffer, GIF87_MAGIC) || hasMagic(buffer, GIF89_MAGIC)) return 'image/gif'
  if (isWebp(buffer)) return 'image/webp'
  return null
}

const SHARP_FORMAT_TO_MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  return null
}

/**
 * @param {Buffer|Uint8Array} source
 * @param {{ declaredMimeType: string }} options
 * @returns {Promise<{ actualMimeType: string, size: number, width: number|null, height: number|null }>}
 * @throws {PhotoSourceValidationError} INVALID_IMAGE_CONTENT | IMAGE_CONTENT_TYPE_MISMATCH
 */
export async function validateRoomPhotoSource(source, { declaredMimeType } = {}) {
  const buffer = toBuffer(source)
  if (!buffer || buffer.length === 0) {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  const declared = typeof declaredMimeType === 'string' ? declaredMimeType.trim().toLowerCase() : ''
  if (!ALLOWED_IMAGE_MIME_TYPES.includes(declared)) {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  const magicMimeType = detectMagicMimeType(buffer)
  if (!magicMimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(magicMimeType)) {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  const sharpOptions = {
    failOn: 'warning',
    limitInputPixels: MAX_ROOM_PHOTO_PIXELS,
    pages: 1,
    animated: false,
  }

  let metadata
  try {
    metadata = await sharp(buffer, sharpOptions).metadata()
  } catch {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  const actualMimeType = metadata.format ? SHARP_FORMAT_TO_MIME[metadata.format] : null
  if (!actualMimeType || !ALLOWED_IMAGE_MIME_TYPES.includes(actualMimeType)) {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  if (actualMimeType !== declared) {
    throw new PhotoSourceValidationError('IMAGE_CONTENT_TYPE_MISMATCH')
  }

  // Forces real pixel decode (STEP 7.15f.3-b: metadata alone is not proof —
  // 5 corrupt PNGs passed .metadata() but failed here). .stats() decodes
  // every pixel internally without handing a raw buffer back to JS.
  try {
    await sharp(buffer, sharpOptions).stats()
  } catch {
    throw new PhotoSourceValidationError('INVALID_IMAGE_CONTENT')
  }

  return {
    actualMimeType,
    size: buffer.length,
    width: typeof metadata.width === 'number' ? metadata.width : null,
    height: typeof metadata.height === 'number' ? metadata.height : null,
  }
}
