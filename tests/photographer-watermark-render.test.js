import { describe, it, expect, beforeEach, vi } from 'vitest'
import sharp from 'sharp'
import { createHash } from 'crypto'

// Real Sharp + real font: proves geometry, orientation and EXIF safety of the
// photographer watermark. Only the logo fetch is mocked.
const getPhotoBufferMock = vi.fn()
vi.mock('@/lib/server/download-utils', () => ({
  getPhotoBuffer: (...args) => getPhotoBufferMock(...args),
}))

const {
  applyPhotographerWatermark,
  buildTextOverlaySvg,
  computeOverlayBox,
  computeOverlayPosition,
  fontHasGlyph,
  renderWatermarkPreview,
  __resetPhotographerWatermarkCaches,
} = await import('@/lib/server/photographer-watermark-render')

const TEXT_SPEC = Object.freeze({ revision: 'a'.repeat(16), type: 'text', text: 'Studio Rossi', logoUrl: null, logoSha256: null, position: 'bottom-right', opacity: 1, sizePercent: 30 })

async function solidJpeg({ width, height, orientation, withGps = false }) {
  let pipeline = sharp({ create: { width, height, channels: 3, background: { r: 20, g: 20, b: 20 } } }).jpeg()
  if (orientation || withGps) {
    pipeline = pipeline.withMetadata({
      ...(orientation ? { orientation } : {}),
      ...(withGps ? { exif: { IFD0: { Make: 'PwmTestCameraMake' }, GPS: { GPSLatitudeRef: 'N', GPSLatitude: '40/1,45/1,1200/100' } } } : {}),
    })
  }
  return pipeline.toBuffer()
}

async function brightness(buffer, { left, top, width, height }) {
  const { data } = await sharp(buffer).extract({ left, top, width, height }).greyscale().raw().toBuffer({ resolveWithObject: true })
  return data.reduce((sum, value) => sum + value, 0) / data.length
}

async function quadrantBrightness(buffer) {
  const { width, height } = await sharp(buffer).metadata()
  const w = Math.floor(width / 2)
  const h = Math.floor(height / 2)
  return {
    'top-left': await brightness(buffer, { left: 0, top: 0, width: w, height: h }),
    'top-right': await brightness(buffer, { left: w, top: 0, width: w, height: h }),
    'bottom-left': await brightness(buffer, { left: 0, top: h, width: w, height: h }),
    'bottom-right': await brightness(buffer, { left: w, top: h, width: w, height: h }),
  }
}

function brightestQuadrant(quadrants) {
  return Object.entries(quadrants).sort((a, b) => b[1] - a[1])[0][0]
}

beforeEach(() => {
  __resetPhotographerWatermarkCaches()
  getPhotoBufferMock.mockReset()
})

describe('geometry', () => {
  it('sizes the overlay as a percentage of the image width, inside the padding', () => {
    const box = computeOverlayBox(1600, 1000, 20)
    expect(box.padding).toBe(56)
    expect(box.targetWidth).toBe(320)
    expect(box.maxHeight).toBe(400)
  })

  it('never exceeds the padded area, even at 50% on a tiny image', () => {
    const box = computeOverlayBox(50, 50, 50)
    expect(box.targetWidth).toBeLessThanOrEqual(50 - box.padding * 2)
  })

  it.each([
    ['top-left', { left: 10, top: 10 }],
    ['top-right', { left: 890, top: 10 }],
    ['bottom-left', { left: 10, top: 940 }],
    ['bottom-right', { left: 890, top: 940 }],
    ['center', { left: 450, top: 475 }],
  ])('%s placement', (position, expected) => {
    expect(computeOverlayPosition({ width: 1000, height: 1000, overlayWidth: 100, overlayHeight: 50, padding: 10, position })).toEqual(expected)
  })
})

describe('text overlay', () => {
  it('contains only numeric path data — the user string never reaches the SVG', () => {
    const text = '<script>alert("x")</script> & Co'
    const { svg } = buildTextOverlaySvg(text, 400, 200, 0.6)
    const markup = svg.toString()
    expect(markup).not.toContain('script')
    expect(markup).not.toContain('alert')
    expect(markup).not.toContain('<text')
    expect(markup).toMatch(/^<svg [^>]+><g opacity="0.6"><path d="[MLQCZ0-9.\s-]+"/)
  })

  it('reports glyph coverage of the bundled font', () => {
    expect(fontHasGlyph('à')).toBe(true)
    expect(fontHasGlyph('©')).toBe(true)
    expect(fontHasGlyph('漢')).toBe(false)
    expect(fontHasGlyph('😀')).toBe(false)
  })
})

describe('applyPhotographerWatermark', () => {
  it('display variant caps the long edge at maxLongEdge and outputs JPEG', async () => {
    const out = await applyPhotographerWatermark(await solidJpeg({ width: 3000, height: 2000 }), TEXT_SPEC, { maxLongEdge: 1600, jpegQuality: 82 })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(1600)
    expect(meta.height).toBe(1067)
  })

  it('original variant keeps the full resolution', async () => {
    const out = await applyPhotographerWatermark(await solidJpeg({ width: 2400, height: 1600 }), TEXT_SPEC, { maxLongEdge: null, jpegQuality: 92 })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([2400, 1600])
  })

  it.each([false, true])('drops all EXIF/GPS metadata (full resolution: %s)', async (fullResolution) => {
    const source = await solidJpeg({ width: 800, height: 600, withGps: true })
    expect(source.includes(Buffer.from('PwmTestCameraMake'))).toBe(true)
    const out = await applyPhotographerWatermark(source, TEXT_SPEC, { maxLongEdge: fullResolution ? null : 1600, jpegQuality: 82 })
    const meta = await sharp(out).metadata()
    expect(meta.exif).toBeUndefined()
    expect(out.includes(Buffer.from('PwmTestCameraMake'))).toBe(false)
  })

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'])('draws the mark in the %s corner', async (position) => {
    const out = await applyPhotographerWatermark(await solidJpeg({ width: 1200, height: 800 }), { ...TEXT_SPEC, position }, { maxLongEdge: 1600, jpegQuality: 90 })
    expect(brightestQuadrant(await quadrantBrightness(out))).toBe(position)
  })

  it.each([false, true])('applies EXIF orientation before placing the mark (full resolution: %s)', async (fullResolution) => {
    // Stored 800x1200 with orientation 6 → displayed 1200x800 (landscape).
    const source = await solidJpeg({ width: 800, height: 1200, orientation: 6 })
    const out = await applyPhotographerWatermark(source, TEXT_SPEC, { maxLongEdge: fullResolution ? null : 1600, jpegQuality: 90 })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([1200, 800])
    expect(meta.orientation).toBeUndefined()
    expect(brightestQuadrant(await quadrantBrightness(out))).toBe('bottom-right')
  })

  it('lower opacity produces a fainter mark', async () => {
    const source = await solidJpeg({ width: 1200, height: 800 })
    const strong = await applyPhotographerWatermark(source, TEXT_SPEC, { maxLongEdge: 1600, jpegQuality: 90 })
    __resetPhotographerWatermarkCaches()
    const faint = await applyPhotographerWatermark(source, { ...TEXT_SPEC, opacity: 0.2 }, { maxLongEdge: 1600, jpegQuality: 90 })
    expect((await quadrantBrightness(faint))['bottom-right']).toBeLessThan((await quadrantBrightness(strong))['bottom-right'])
  })

  it('renders a logo after verifying its bytes against logoSha256', async () => {
    const logo = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const logoSha256 = createHash('sha256').update(logo).digest('hex')
    getPhotoBufferMock.mockResolvedValue(logo)
    const spec = { ...TEXT_SPEC, type: 'logo', text: null, logoUrl: 'https://x.public.blob.vercel-storage.com/watermarks/o/l.png', logoSha256, position: 'top-left' }
    const out = await applyPhotographerWatermark(await solidJpeg({ width: 1200, height: 800 }), spec, { maxLongEdge: 1600, jpegQuality: 90 })
    expect(brightestQuadrant(await quadrantBrightness(out))).toBe('top-left')
    expect(getPhotoBufferMock).toHaveBeenCalledWith(spec.logoUrl)
  })

  it('refuses a logo whose bytes do not match the configured hash', async () => {
    getPhotoBufferMock.mockResolvedValue(Buffer.from('not the logo'))
    const spec = { ...TEXT_SPEC, type: 'logo', text: null, logoUrl: 'https://x.public.blob.vercel-storage.com/l.png', logoSha256: 'b'.repeat(64) }
    await expect(applyPhotographerWatermark(await solidJpeg({ width: 400, height: 300 }), spec, { maxLongEdge: 1600, jpegQuality: 82 })).rejects.toThrow(/hash/)
  })

  it('handles a tiny source without placing the mark out of bounds', async () => {
    const out = await applyPhotographerWatermark(await solidJpeg({ width: 50, height: 50 }), { ...TEXT_SPEC, sizePercent: 50 }, { maxLongEdge: 1600, jpegQuality: 82 })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([50, 50])
  })
})

describe('renderWatermarkPreview', () => {
  it.each([['landscape', 900, 600], ['portrait', 600, 900]])('renders a %s JPEG preview', async (sample, width, height) => {
    const out = await renderWatermarkPreview(TEXT_SPEC, { sample })
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', width, height])
  })
})
