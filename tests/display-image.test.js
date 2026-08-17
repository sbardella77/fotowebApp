import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  transformDisplayImage,
  DISPLAY_MAX_LONG_EDGE,
  DISPLAY_QUALITY,
  DISPLAY_FORMAT,
  DISPLAY_BACKGROUND,
  DISPLAY_TRANSFORM_CONFIG,
} from '@/lib/server/display-derivative'

// STEP 7.15c — the display rendition itself (real Sharp, synthetic fixtures).
//
// The long-edge cap asserted here is the Free-display monetization boundary,
// not a quality preference: product copy sells "full resolution as uploaded"
// as the paid capability, and the only enforceable way to withhold it is to
// never send those pixels to the browser.

const solid = (width, height, rgb = { r: 120, g: 90, b: 200 }) =>
  sharp({ create: { width, height, channels: 3, background: rgb } })

const jpegFixture = (w, h) => solid(w, h).jpeg({ quality: 92 }).toBuffer()
const pngFixture = (w, h) => solid(w, h).png().toBuffer()
const webpFixture = (w, h) => solid(w, h).webp().toBuffer()
const gifFixture = (w, h) => solid(w, h).gif().toBuffer()

/** RGBA fixture whose left half is fully transparent. */
const transparentPngFixture = async (w, h) => {
  const raw = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      raw[i] = 10
      raw[i + 1] = 20
      raw[i + 2] = 30
      raw[i + 3] = x < w / 2 ? 0 : 255
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

/** Genuinely multi-frame animated GIF: frames stacked vertically as pages. */
const animatedGifFixture = async (w, h, frames = 3) => {
  const raw = Buffer.alloc(w * h * frames * 3)
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < w * h; p++) {
      const i = (f * w * h + p) * 3
      raw[i] = f === 0 ? 255 : 0
      raw[i + 1] = f === 1 ? 255 : 0
      raw[i + 2] = f === 2 ? 255 : 0
    }
  }
  return sharp(raw, {
    raw: { width: w, height: h * frames, channels: 3, pageHeight: h },
  })
    .gif()
    .toBuffer()
}

const meta = (buf) => sharp(buf).metadata()

describe('display transform — output format contract', () => {
  it.each([
    ['JPEG', jpegFixture],
    ['PNG', pngFixture],
    ['WebP', webpFixture],
    ['GIF', gifFixture],
  ])('%s source produces a JPEG', async (_label, makeFixture) => {
    const out = await transformDisplayImage(await makeFixture(2000, 1500))
    const m = await meta(out)

    expect(m.format).toBe('jpeg')
    expect(DISPLAY_FORMAT).toBe('jpeg')
  })

  it('uses the explicit configured quality rather than a Sharp default', async () => {
    const source = await jpegFixture(2000, 1500)
    const out = await transformDisplayImage(source)
    const atConfigured = await sharp(source)
      .rotate()
      .resize(DISPLAY_MAX_LONG_EDGE, DISPLAY_MAX_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: DISPLAY_BACKGROUND })
      .jpeg({ quality: DISPLAY_QUALITY })
      .toBuffer()

    expect(out.length).toBe(atConfigured.length)
    expect(DISPLAY_QUALITY).toBe(82)
  })

  it('exposes a frozen transform config', () => {
    expect(DISPLAY_TRANSFORM_CONFIG).toEqual({
      maxLongEdge: 1600,
      format: 'jpeg',
      quality: 82,
      background: '#ffffff',
    })
    expect(Object.isFrozen(DISPLAY_TRANSFORM_CONFIG)).toBe(true)
  })
})

describe('display transform — resize semantics', () => {
  it('caps the long edge of a landscape source', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(4000, 3000)))
    expect([m.width, m.height]).toEqual([1600, 1200])
  })

  it('caps the long edge of a portrait source (height, not width)', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(3000, 4000)))
    expect([m.width, m.height]).toEqual([1200, 1600])
  })

  it('caps a square source on both edges', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(3000, 3000)))
    expect([m.width, m.height]).toEqual([1600, 1600])
  })

  it('preserves aspect ratio without cropping (3:2 stays 3:2)', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(6000, 4000)))
    expect(m.width).toBe(1600)
    expect(Math.abs(m.width / m.height - 6000 / 4000)).toBeLessThan(0.01)
  })

  it('NEVER upscales a source smaller than the cap', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(800, 600)))
    expect([m.width, m.height]).toEqual([800, 600])
  })

  it('leaves a source exactly at the cap unchanged', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(1600, 900)))
    expect([m.width, m.height]).toEqual([1600, 900])
  })

  it('does not upscale a tiny source even on its long edge', async () => {
    const m = await meta(await transformDisplayImage(await jpegFixture(120, 90)))
    expect([m.width, m.height]).toEqual([120, 90])
  })
})

describe('display transform — EXIF orientation', () => {
  const orientedFixture = async (orientation, w = 400, h = 200) =>
    solid(w, h).withMetadata({ orientation }).jpeg().toBuffer()

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'orientation %i is applied and leaves no residual rotation for the consumer',
    async (orientation) => {
      const out = await transformDisplayImage(await orientedFixture(orientation))
      const m = await meta(out)

      // Sharp strips metadata on output, so any orientation tag that survived
      // would make a second consumer rotate an already-rotated image.
      expect(m.orientation === undefined || m.orientation === 1).toBe(true)
    },
  )

  it('orientation 6 turns a stored landscape into a physically portrait output', async () => {
    const m = await meta(await transformDisplayImage(await orientedFixture(6, 400, 200)))
    expect(m.width).toBe(200)
    expect(m.height).toBe(400)
  })

  it('orientation 1 leaves axes unswapped', async () => {
    const m = await meta(await transformDisplayImage(await orientedFixture(1, 400, 200)))
    expect(m.width).toBe(400)
    expect(m.height).toBe(200)
  })

  it('an axis-swapping orientation is capped on the ORIENTED long edge', async () => {
    // Stored 4000x1000; orientation 6 displays it as 1000x4000, so the cap
    // must apply to the 4000 that the viewer actually sees vertically.
    const m = await meta(await transformDisplayImage(await orientedFixture(6, 4000, 1000)))
    expect(Math.max(m.width, m.height)).toBe(1600)
    expect(m.height).toBeGreaterThan(m.width)
  })
})

describe('display transform — transparency', () => {
  it('flattens alpha to WHITE, not black', async () => {
    const out = await transformDisplayImage(await transparentPngFixture(200, 100))
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })

    // sample well inside the originally-transparent left half
    const x = 10
    const y = 50
    const i = (y * info.width + x) * info.channels
    expect(data[i]).toBeGreaterThan(245)
    expect(data[i + 1]).toBeGreaterThan(245)
    expect(data[i + 2]).toBeGreaterThan(245)
  })

  it('output has no alpha channel at all', async () => {
    const m = await meta(await transformDisplayImage(await transparentPngFixture(200, 100)))
    expect(m.hasAlpha).toBeFalsy()
    expect(m.channels).toBe(3)
  })
})

describe('display transform — animated GIF contract', () => {
  it('the fixture really is multi-frame', async () => {
    const m = await meta(await animatedGifFixture(60, 40, 3))
    expect(m.pages).toBe(3)
  })

  it('collapses an animated GIF to a single static JPEG frame', async () => {
    const out = await transformDisplayImage(await animatedGifFixture(60, 40, 3))
    const m = await meta(out)

    expect(m.format).toBe('jpeg')
    expect(m.pages === undefined || m.pages === 1).toBe(true)
  })

  it('keeps the first frame, not a later one', async () => {
    // frame 0 is pure red, frame 1 green, frame 2 blue
    const out = await transformDisplayImage(await animatedGifFixture(60, 40, 3))
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels

    expect(data[i]).toBeGreaterThan(180) // red channel dominant
    expect(data[i + 1]).toBeLessThan(90)
    expect(data[i + 2]).toBeLessThan(90)
  })

  it('does not vertically stack frames into one tall image', async () => {
    const out = await transformDisplayImage(await animatedGifFixture(60, 40, 3))
    const m = await meta(out)
    expect(m.height).toBe(40)
  })
})

describe('SECURITY: Free-display monetization boundary', () => {
  // This is the invariant that makes "original quality" a paid capability.
  // If it ever regresses, Free browsers receive paid-quality pixels and the
  // entitlement becomes unenforceable — no client-side measure can recover it.
  it.each([
    ['landscape 6000x4000', () => jpegFixture(6000, 4000)],
    ['portrait 4000x6000', () => jpegFixture(4000, 6000)],
    ['square 5000x5000', () => jpegFixture(5000, 5000)],
    ['already small 800x600', () => jpegFixture(800, 600)],
    ['exactly at cap 1600x1600', () => jpegFixture(1600, 1600)],
    ['PNG 4000x3000', () => pngFixture(4000, 3000)],
    ['WebP 4000x3000', () => webpFixture(4000, 3000)],
    ['GIF 4000x3000', () => gifFixture(4000, 3000)],
  ])('%s never exceeds the long-edge cap', async (_label, makeFixture) => {
    const m = await meta(await transformDisplayImage(await makeFixture()))
    expect(Math.max(m.width, m.height)).toBeLessThanOrEqual(DISPLAY_MAX_LONG_EDGE)
  })

  it('EXIF-rotated sources are also capped on the oriented long edge', async () => {
    const src = await solid(5000, 2000).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const m = await meta(await transformDisplayImage(src))
    expect(Math.max(m.width, m.height)).toBeLessThanOrEqual(DISPLAY_MAX_LONG_EDGE)
  })

  it('output is strictly smaller than a 2400px client-optimizer original', async () => {
    // Guest uploads are already capped at 2400 by lib/client-image-optimizer.
    // The display rendition must stay materially below that ceiling or the
    // paid unlock has no product meaning.
    const m = await meta(await transformDisplayImage(await jpegFixture(2400, 1800)))
    expect(Math.max(m.width, m.height)).toBe(1600)
    expect(Math.max(m.width, m.height)).toBeLessThan(2400)
  })
})
