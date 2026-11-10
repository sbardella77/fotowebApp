import sharp from 'sharp'

/**
 * Remove private metadata (GPS, camera serials, XMP, IPTC, comments) from an
 * original photo WITHOUT re-encoding its pixels, so "Original quality" stays
 * bit-identical image data while a guest's location never leaves the server.
 *
 * Guest uploads keep their original bytes (no client-side resize), so the
 * stored source may carry the uploader's EXIF. Every ORIGINAL download goes
 * through here.
 *
 * - JPEG: metadata segments are dropped; the EXIF block is replaced by a
 *   minimal one holding only Orientation, so phone photos stay upright.
 *   ICC profiles (APP2) are kept for faithful colour. Data after the primary
 *   image's EOI (MPF gain maps / depth images, which carry their own
 *   metadata) is dropped.
 * - PNG: textual and eXIf chunks are dropped.
 * - WebP: EXIF and XMP chunks are dropped and the VP8X flags cleared.
 * - GIF: no standard place for GPS; returned as is.
 * - Anything unparseable falls back to a high-quality Sharp re-encode, which
 *   never writes metadata: fail closed on privacy rather than on delivery.
 */
export async function stripPrivateMetadata(buffer) {
  try {
    if (isJpeg(buffer)) return stripJpeg(buffer)
    if (isPng(buffer)) return stripPng(buffer)
    if (isWebp(buffer)) return stripWebp(buffer)
    if (isGif(buffer)) return buffer
  } catch {
    // Malformed container: fall through to the re-encode below.
  }
  return reencodeWithoutMetadata(buffer)
}

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a
const isWebp = (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
const isGif = (b) => b.length > 6 && b.toString('ascii', 0, 3) === 'GIF'

async function reencodeWithoutMetadata(buffer) {
  const image = sharp(buffer).rotate()
  const { format } = await sharp(buffer).metadata()
  if (format === 'png') return image.png().toBuffer()
  if (format === 'webp') return image.webp({ quality: 95 }).toBuffer()
  return image.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer()
}

// ─── JPEG ────────────────────────────────────────────────────────────────────

const APP1 = 0xe1
const APP2 = 0xe2
const APP14 = 0xee
const SOS = 0xda
const EOI = 0xd9

function stripJpeg(buffer) {
  const out = [buffer.subarray(0, 2)]
  let orientation = null
  let offset = 2

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('JPEG marker expected')
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset += 1 // fill byte
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    const segment = buffer.subarray(offset, offset + 2 + length)
    if (segment.length !== 2 + length) throw new Error('Truncated JPEG segment')

    if (marker === SOS) {
      if (orientation && orientation !== 1) {
        // Right after SOI, or after JFIF APP0, which must come first.
        out.splice(out[1]?.[1] === 0xe0 ? 2 : 1, 0, orientationExifSegment(orientation))
      }
      out.push(buffer.subarray(offset, findPrimaryEoi(buffer, offset + 2 + length)))
      return Buffer.concat(out)
    }

    const isApp = marker >= 0xe0 && marker <= 0xef
    const isComment = marker === 0xfe
    if (marker === APP1 && segment.toString('ascii', 4, 10) === 'Exif\0\0') {
      orientation = readExifOrientation(segment.subarray(10)) ?? orientation
    } else if (marker === APP2 && segment.toString('ascii', 4, 16) === 'ICC_PROFILE\0') {
      out.push(segment)
    } else if (marker === 0xe0 || marker === APP14 || (!isApp && !isComment)) {
      // JFIF/JFXX, Adobe colour transform, and every non-metadata segment
      // (quantisation/Huffman tables, frame header, restart interval).
      out.push(segment)
    }
    offset += 2 + length
  }
  throw new Error('JPEG has no scan data')
}

/** End (exclusive) of the primary image: the first EOI outside entropy data. */
function findPrimaryEoi(buffer, from) {
  for (let i = from; i < buffer.length - 1; i++) {
    if (buffer[i] !== 0xff) continue
    const next = buffer[i + 1]
    // 0x00 is a stuffed byte and RST0-7 live inside entropy data; any other
    // marker (a further SOS/DHT in progressive JPEGs) is part of the image.
    if (next === EOI) return i + 2
  }
  return buffer.length
}

function readExifOrientation(tiff) {
  const order = tiff.toString('ascii', 0, 2)
  if (order !== 'II' && order !== 'MM') return null
  const le = order === 'II'
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
  const ifd0 = u32(4)
  const count = u16(ifd0)
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** APP1 "Exif" segment with a single IFD0 entry: Orientation (SHORT). */
export function orientationExifSegment(orientation) {
  const tiff = Buffer.alloc(26)
  tiff.write('MM', 0, 'ascii')
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4) // IFD0 offset
  tiff.writeUInt16BE(1, 8) // one entry
  tiff.writeUInt16BE(0x0112, 10) // Orientation
  tiff.writeUInt16BE(3, 12) // SHORT
  tiff.writeUInt32BE(1, 14) // count
  tiff.writeUInt16BE(orientation, 18)
  tiff.writeUInt32BE(0, 22) // no next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])
  const header = Buffer.from([0xff, APP1, 0, 0])
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const PNG_PRIVATE_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

function stripPng(buffer) {
  const out = [buffer.subarray(0, 8)]
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > buffer.length) throw new Error('Truncated PNG chunk')
    if (!PNG_PRIVATE_CHUNKS.has(type)) out.push(buffer.subarray(offset, end))
    offset = end
    if (type === 'IEND') break
  }
  return Buffer.concat(out)
}

// ─── WebP ────────────────────────────────────────────────────────────────────

function stripWebp(buffer) {
  const chunks = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (offset + 8 + size > buffer.length) throw new Error('Truncated WebP chunk')
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buffer.subarray(offset, Math.min(end, buffer.length)))
      if (type === 'VP8X') chunk[8] &= ~(0x08 | 0x04) // clear EXIF + XMP flags
      chunks.push(chunk)
    }
    offset = end
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'ascii')
  return Buffer.concat([header, body])
}
