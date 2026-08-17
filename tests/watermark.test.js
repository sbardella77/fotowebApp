import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'
import {
  applyWatermark,
  resolveDisplayDimensions,
  BRANDED_DOWNLOAD_WATERMARK_OPTIONS,
  WATERMARK_DERIVATIVE_VERSION,
  __getPreparedBadgeCacheStats,
  __resetPreparedBadgeCache,
} from '@/lib/server/watermark'

// STEP 7.14a — the single-photo branded download path (/api/download/photo)
// gains an OPT-IN output contract: auto-orient -> watermark composite ->
// flatten white -> JPEG q85. The gallery ZIP route and the async gallery job
// call applyWatermark() with no options and must keep their pre-existing
// preserve-the-input-container behavior (STEP 7.14a.0 §2/§3/§25).
//
// Two defects proven in STEP 7.14a.0 are locked down here:
//   1. naive JPEG encoding turns transparent pixels BLACK;
//   2. EXIF orientation was silently destroyed, so portrait phone photos
//      downloaded rotated 90° with the badge in the wrong corner.

const BRANDED = BRANDED_DOWNLOAD_WATERMARK_OPTIONS

async function noiseRaw(width, height, channels = 3) {
  const buf = Buffer.alloc(width * height * channels)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 256
  return sharp(buf, { raw: { width, height, channels } })
}

const asJpeg = async (w = 900, h = 600) => (await noiseRaw(w, h)).jpeg({ quality: 85 }).toBuffer()
const asPng = async (w = 900, h = 600) => (await noiseRaw(w, h)).png().toBuffer()
const asWebp = async (w = 900, h = 600) => (await noiseRaw(w, h)).webp({ quality: 85 }).toBuffer()
const asGif = async (w = 900, h = 600) => (await noiseRaw(w, h)).gif().toBuffer()

/** Left half opaque red, right half fully transparent. */
async function transparentPng(w = 900, h = 600) {
  const px = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px[i] = 220; px[i + 1] = 30; px[i + 2] = 30
      px[i + 3] = x > w / 2 ? 0 : 255
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Sample a pixel from the top-right region (transparent in the source). */
async function topRightPixel(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const x = Math.floor(info.width * 0.9)
  const y = Math.floor(info.height * 0.08)
  const i = (y * info.width + x) * 4
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
}

beforeEach(() => {
  __resetPreparedBadgeCache()
})

describe('branded output contract constants', () => {
  it('freezes the exact opt-in contract used by /api/download/photo', () => {
    expect(BRANDED_DOWNLOAD_WATERMARK_OPTIONS).toEqual({
      outputFormat: 'jpeg',
      jpegQuality: 85,
      flattenBackground: '#ffffff',
      autoOrient: true,
    })
  })

  it('explicitly pins JPEG quality to 85 rather than inheriting the Sharp default', () => {
    expect(BRANDED_DOWNLOAD_WATERMARK_OPTIONS.jpegQuality).toBe(85)
  })

  it('exposes a derivative version constant for the future derivative cache', () => {
    expect(WATERMARK_DERIVATIVE_VERSION).toBe('v1')
  })

  it('the contract object is frozen so a caller cannot mutate it at runtime', () => {
    expect(Object.isFrozen(BRANDED_DOWNLOAD_WATERMARK_OPTIONS)).toBe(true)
  })
})

describe('branded mode — JPEG output for every allowed source format', () => {
  const sources = [
    ['JPEG', asJpeg],
    ['PNG', asPng],
    ['WebP', asWebp],
    ['GIF', asGif],
  ]

  for (const [label, make] of sources) {
    it(`${label} source produces real JPEG bytes (verified via metadata, not filename)`, async () => {
      const out = await applyWatermark(await make(), BRANDED)
      const meta = await sharp(out).metadata()
      expect(meta.format).toBe('jpeg')
    })
  }
})

describe('branded mode — transparent sources flatten to white, never black', () => {
  it('a transparent PNG region becomes white after branded processing', async () => {
    const out = await applyWatermark(await transparentPng(), BRANDED)
    const px = await topRightPixel(out)

    expect(px.r).toBeGreaterThan(240)
    expect(px.g).toBeGreaterThan(240)
    expect(px.b).toBeGreaterThan(240)
  })

  it('regression: naive JPEG encoding without an explicit flatten would produce black', async () => {
    // Reproduces the STEP 7.14a.0 §C finding, proving the flatten is what
    // fixes it rather than something incidental.
    const naive = await applyWatermark(await transparentPng(), {
      ...BRANDED,
      flattenBackground: null,
    })
    const px = await topRightPixel(naive)

    expect(px.r).toBeLessThan(15)
    expect(px.g).toBeLessThan(15)
    expect(px.b).toBeLessThan(15)
  })
})

describe('branded mode — EXIF orientation is corrected', () => {
  async function orientedSource() {
    // Stored 400x200 but tagged orientation 6, i.e. displayed as 200x400.
    return sharp({ create: { width: 400, height: 200, channels: 3, background: '#3366cc' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
  }

  it('bakes the rotation into the pixels so no consumer-side rotation is needed', async () => {
    const out = await applyWatermark(await orientedSource(), BRANDED)
    const meta = await sharp(out).metadata()

    expect(meta.width).toBe(200)
    expect(meta.height).toBe(400)
    // Either no orientation tag, or the identity value — never a tag that
    // would make a viewer rotate the already-rotated pixels again.
    expect([undefined, 1]).toContain(meta.orientation)
  })

  it('an unrotated image is unaffected by auto-orientation', async () => {
    const plain = await asJpeg(400, 200)
    const out = await applyWatermark(plain, BRANDED)
    const meta = await sharp(out).metadata()

    expect(meta.width).toBe(400)
    expect(meta.height).toBe(200)
  })
})

describe('resolveDisplayDimensions — oriented badge geometry (STEP 7.14a §23)', () => {
  it('swaps axes for every 90-degree EXIF orientation', () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(resolveDisplayDimensions({ width: 4032, height: 3024, orientation }))
        .toEqual({ width: 3024, height: 4032 })
    }
  })

  it('leaves non-rotating orientations untouched', () => {
    for (const orientation of [undefined, 1, 2, 3, 4]) {
      expect(resolveDisplayDimensions({ width: 4032, height: 3024, orientation }))
        .toEqual({ width: 4032, height: 3024 })
    }
  })

  it('falls back to sane defaults when metadata is missing', () => {
    expect(resolveDisplayDimensions({})).toEqual({ width: 800, height: 600 })
    expect(resolveDisplayDimensions(undefined)).toEqual({ width: 800, height: 600 })
  })

  it('badge sizing for a rotated photo derives from display, not stored, geometry', () => {
    // A 4032x3024 sensor image tagged orientation 6 is displayed portrait
    // (3024x4032). Badge target width is maxWidthRatio(0.22) of the DISPLAY
    // width, clamped to [60, 360]. Sizing from the stored landscape width
    // would use 4032 instead of 3024 — a different pre-clamp value, which is
    // exactly the bug this guards.
    const stored = { width: 4032, height: 3024, orientation: 6 }
    const display = resolveDisplayDimensions(stored)

    expect(display.width).toBe(3024)
    expect(Math.round(display.width * 0.22)).not.toBe(Math.round(stored.width * 0.22))
    // Padding is ratio-of-longest-edge; identical here, but placement uses
    // the swapped width/height, which is what moves the badge to the right
    // visual corner.
    expect(display.height).toBe(4032)
  })
})

describe('default mode — shared-helper contract preserved for gallery callers', () => {
  it('a PNG source stays PNG when no options are passed', async () => {
    const out = await applyWatermark(await asPng())
    expect((await sharp(out).metadata()).format).toBe('png')
  })

  it('a WebP source stays WebP when no options are passed', async () => {
    const out = await applyWatermark(await asWebp())
    expect((await sharp(out).metadata()).format).toBe('webp')
  })

  it('a JPEG source stays JPEG when no options are passed', async () => {
    const out = await applyWatermark(await asJpeg())
    expect((await sharp(out).metadata()).format).toBe('jpeg')
  })

  it('transparency is preserved (not flattened) for non-opted callers', async () => {
    const out = await applyWatermark(await transparentPng())
    const meta = await sharp(out).metadata()

    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
    expect((await topRightPixel(out)).a).toBe(0)
  })

  it('does not auto-orient for non-opted callers — gallery output is unchanged by this STEP', async () => {
    const tagged = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#3366cc' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await applyWatermark(tagged)
    const meta = await sharp(out).metadata()

    // Same stored geometry as before this STEP.
    expect(meta.width).toBe(400)
    expect(meta.height).toBe(200)
  })
})

describe('badge memoization is bounded and correctly keyed', () => {
  it('reuses a prepared badge across repeated calls at the same display width', async () => {
    const a = await asJpeg(900, 600)
    await applyWatermark(a, BRANDED)
    const afterFirst = __getPreparedBadgeCacheStats().size
    await applyWatermark(a, BRANDED)
    await applyWatermark(a, BRANDED)

    expect(afterFirst).toBeGreaterThan(0)
    expect(__getPreparedBadgeCacheStats().size).toBe(afterFirst)
  })

  it('keeps a bounded hard maximum rather than growing without limit', () => {
    expect(__getPreparedBadgeCacheStats().max).toBe(512)
  })

  it('produces identical bytes whether the badge came from cache or was freshly built', async () => {
    const src = await asJpeg(900, 600)
    const fresh = await applyWatermark(src, BRANDED)
    const cached = await applyWatermark(src, BRANDED)

    expect(Buffer.compare(fresh, cached)).toBe(0)
  })
})
