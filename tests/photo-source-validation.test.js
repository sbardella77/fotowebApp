import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  validateRoomPhotoSource,
  PhotoSourceValidationError,
  MAX_ROOM_PHOTO_PIXELS,
} from '@/lib/server/photo-source-validation'

// STEP 7.15g — server-side ROOM_PHOTO source-integrity validation.
//
// Pure-function tests only: no DB, no Blob, no network. Every fixture here
// is fully synthetic — no Production source bytes, per instruction.

async function makeValidJpeg({ width = 8, height = 8 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg({ quality: 82 })
    .toBuffer()
}

async function makeValidPng({ width = 8, height = 8 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .png()
    .toBuffer()
}

async function makeValidWebp({ width = 8, height = 8 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: { r: 5, g: 120, b: 200 } } })
    .webp({ quality: 80 })
    .toBuffer()
}

async function makeValidGif() {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .gif()
    .toBuffer()
}

async function makeAnimatedGif() {
  // Two 4x4 frames joined into one animated GIF.
  const frameA = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png()
    .toBuffer()
  const frameB = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 255 } } })
    .png()
    .toBuffer()
  return sharp([frameA, frameB], { join: { animated: true } }).gif().toBuffer()
}

// A PNG truncated deep inside its IDAT stream: enough of the file survives
// for the header/IHDR to parse (format/width/height all report correctly),
// but not enough compressed pixel data survives for a real decode to
// succeed. Uses a larger (64x64) source so there is enough IDAT payload to
// cut meaningfully — empirically verified (not guessed) to reproduce
// metadata-succeeds/pixel-decode-fails, the exact split STEP 7.15f.3-b found
// in the 5 legacy corrupt PNGs (a 33-byte IHDR-only truncation is instead
// too aggressive and fails even at metadata parsing, which is a different,
// less faithful fixture).
async function makeTruncatedPng() {
  const full = await makeValidPng({ width: 64, height: 64 })
  return full.subarray(0, Math.floor(full.length * 0.9))
}

describe('validateRoomPhotoSource — buffer contract', () => {
  it('rejects empty buffer', async () => {
    await expect(validateRoomPhotoSource(Buffer.alloc(0), { declaredMimeType: 'image/jpeg' })).rejects.toBeInstanceOf(
      PhotoSourceValidationError,
    )
  })

  it('rejects non-buffer input', async () => {
    await expect(validateRoomPhotoSource('not a buffer', { declaredMimeType: 'image/jpeg' })).rejects.toBeInstanceOf(
      PhotoSourceValidationError,
    )
  })

  it('rejects missing/unsupported declaredMimeType', async () => {
    const jpeg = await makeValidJpeg()
    await expect(validateRoomPhotoSource(jpeg, { declaredMimeType: 'application/pdf' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
    await expect(validateRoomPhotoSource(jpeg, {})).rejects.toMatchObject({ code: 'INVALID_IMAGE_CONTENT' })
  })

  it('accepts Uint8Array input equivalently to Buffer', async () => {
    const jpeg = await makeValidJpeg()
    const asUint8 = new Uint8Array(jpeg)
    const result = await validateRoomPhotoSource(asUint8, { declaredMimeType: 'image/jpeg' })
    expect(result.actualMimeType).toBe('image/jpeg')
  })
})

describe('validateRoomPhotoSource — valid format matrix', () => {
  it('valid JPEG passes', async () => {
    const buffer = await makeValidJpeg()
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/jpeg' })
    expect(result.actualMimeType).toBe('image/jpeg')
    expect(result.size).toBe(buffer.length)
    expect(result.width).toBe(8)
    expect(result.height).toBe(8)
  })

  it('valid PNG passes', async () => {
    const buffer = await makeValidPng()
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/png' })
    expect(result.actualMimeType).toBe('image/png')
  })

  it('valid WebP passes', async () => {
    const buffer = await makeValidWebp()
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/webp' })
    expect(result.actualMimeType).toBe('image/webp')
  })

  it('valid GIF passes', async () => {
    const buffer = await makeValidGif()
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/gif' })
    expect(result.actualMimeType).toBe('image/gif')
  })

  it('valid animated GIF is accepted using first-frame semantics (no full-animation decode required)', async () => {
    const buffer = await makeAnimatedGif()
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/gif' })
    expect(result.actualMimeType).toBe('image/gif')
    // First-page-only: reported height must be a single frame's height, not
    // pages * frameHeight (which sharp reports when animated:true is used).
    expect(result.height).toBe(4)
  })

  it('merge-blocking: a clean synthetic 1x1 PNG passes — proves 1x1 is not the rejection cause', async () => {
    const buffer = await makeValidPng({ width: 1, height: 1 })
    const result = await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/png' })
    expect(result.actualMimeType).toBe('image/png')
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
  })
})

describe('validateRoomPhotoSource — deterministic rejection matrix', () => {
  it('merge-blocking: plain text declared image/jpeg is rejected without needing a Sharp decode', async () => {
    const buffer = Buffer.from('just some plain text pretending to be a photo', 'utf8')
    await expect(validateRoomPhotoSource(buffer, { declaredMimeType: 'image/jpeg' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
  })

  it('HTML declared as an allowed image MIME is rejected', async () => {
    const buffer = Buffer.from('<!DOCTYPE html><html><body>not an image</body></html>', 'utf8')
    await expect(validateRoomPhotoSource(buffer, { declaredMimeType: 'image/png' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
  })

  it('JSON declared as an allowed image MIME is rejected', async () => {
    const buffer = Buffer.from(JSON.stringify({ error: 'not found' }), 'utf8')
    await expect(validateRoomPhotoSource(buffer, { declaredMimeType: 'image/jpeg' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
  })

  it('merge-blocking: truncated PNG (valid signature+metadata, pixel decode fails) is rejected', async () => {
    const buffer = await makeTruncatedPng()
    // Confirm the fixture really does pass metadata but is not a full image,
    // so this test is proven to exercise the pixel-decode stage, not magic
    // bytes or metadata parsing.
    const metadata = await sharp(buffer).metadata()
    expect(metadata.format).toBe('png')

    await expect(validateRoomPhotoSource(buffer, { declaredMimeType: 'image/png' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
  })

  it('actual decoded format differs from declared MIME → IMAGE_CONTENT_TYPE_MISMATCH', async () => {
    const buffer = await makeValidPng()
    await expect(validateRoomPhotoSource(buffer, { declaredMimeType: 'image/jpeg' })).rejects.toMatchObject({
      code: 'IMAGE_CONTENT_TYPE_MISMATCH',
    })
  })

  it('input pixel limit: a header claiming dimensions over MAX_ROOM_PHOTO_PIXELS is rejected without allocating a giant image', async () => {
    // A real, tiny, valid PNG whose IHDR is patched to declare an oversized
    // width so libvips' own limitInputPixels guard rejects it — no actual
    // 50-megapixel buffer is ever created for this test.
    const smallPng = await makeValidPng({ width: 4, height: 4 })
    const patched = Buffer.from(smallPng)
    // IHDR width is the first 4 bytes of the 13-byte IHDR data field, which
    // starts at offset 16 (8 signature + 4 length + 4 'IHDR' type).
    const oversizedWidth = Math.ceil(MAX_ROOM_PHOTO_PIXELS / 4) + 1000
    patched.writeUInt32BE(oversizedWidth, 16)

    await expect(validateRoomPhotoSource(patched, { declaredMimeType: 'image/png' })).rejects.toMatchObject({
      code: 'INVALID_IMAGE_CONTENT',
    })
  })
})

describe('validateRoomPhotoSource — error privacy', () => {
  it('rejection errors never contain the raw input bytes or a filename/URL', async () => {
    const distinctiveText = 'SENTINEL_MARKER_should_never_leak_into_error_output_or_message'
    const buffer = Buffer.from(distinctiveText, 'utf8')
    let caught
    try {
      await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/jpeg' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PhotoSourceValidationError)
    expect(caught.message).not.toContain(distinctiveText)
    expect(JSON.stringify(caught)).not.toContain(distinctiveText)
    expect(caught.name).toBe('PhotoSourceValidationError')
    expect(typeof caught.code).toBe('string')
  })

  it('rejection errors do not leak raw Sharp/libvips error text', async () => {
    const buffer = await makeTruncatedPng()
    let caught
    try {
      await validateRoomPhotoSource(buffer, { declaredMimeType: 'image/png' })
    } catch (error) {
      caught = error
    }
    // The only allowed message shape is the module's own fixed template.
    expect(caught.message).toBe('PhotoSourceValidationError: INVALID_IMAGE_CONTENT')
  })
})

describe('validateRoomPhotoSource — pure function, no side effects', () => {
  it('is exported alongside MAX_ROOM_PHOTO_PIXELS pinned to 50,000,000', () => {
    expect(MAX_ROOM_PHOTO_PIXELS).toBe(50_000_000)
  })
})
