import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { transformDisplayImage, DISPLAY_MAX_LONG_EDGE } from '@/lib/server/display-derivative'

// TASK-02 — EXIF Safe Delivery Foundation, Section J.
//
// This is a real, deterministic regression proof that transformDisplayImage
// strips sensitive EXIF metadata — not an assumption that "Sharp normally
// strips metadata." A fixture JPEG is built with real, distinctive GPS,
// camera, and capture-timestamp EXIF (via sharp's own withMetadata, so no
// binary fixture file or extra dependency is needed), the fixture is
// verified to actually carry that data before the transform runs, and the
// transformed output is checked both structurally (no EXIF segment at all)
// and at the raw-byte level (the distinctive camera strings cannot appear
// anywhere in the output, however metadata happens to be represented).

const FIXTURE_MAKE = 'ExifSafetyTestCameraMake9f3a'
const FIXTURE_MODEL = 'ExifSafetyTestCameraModel7c1e'
const FIXTURE_DATETIME = '2019:06:15 10:30:00'
const FIXTURE_SOFTWARE = 'ExifSafetyTestSoftwareTag'

async function buildFixtureWithExif({ width = 8, height = 4, orientation } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 60, b: 200 } },
  })
    .jpeg()
    .withMetadata({
      ...(orientation ? { orientation } : {}),
      exif: {
        IFD0: {
          Make: FIXTURE_MAKE,
          Model: FIXTURE_MODEL,
          DateTime: FIXTURE_DATETIME,
          Software: FIXTURE_SOFTWARE,
        },
        ExifIFD: {
          DateTimeOriginal: FIXTURE_DATETIME,
        },
        // GPS coordinates are IFD-rational (binary), not ASCII, so their
        // absence is proven below via full-segment absence rather than a
        // string search — see the "no EXIF segment at all" assertion.
        GPS: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1,45/1,1200/100',
          GPSLongitudeRef: 'E',
          GPSLongitude: '9/1,11/1,3600/100',
        },
      },
    })
    .toBuffer()
}

describe('EXIF fixture sanity — the fixture itself really carries the metadata under test', () => {
  it('fixture bytes contain the distinctive Make/Model/Software strings', async () => {
    const fixture = await buildFixtureWithExif()
    expect(fixture.includes(Buffer.from(FIXTURE_MAKE))).toBe(true)
    expect(fixture.includes(Buffer.from(FIXTURE_MODEL))).toBe(true)
    expect(fixture.includes(Buffer.from(FIXTURE_SOFTWARE))).toBe(true)
  })

  it('fixture carries a real EXIF segment sharp itself recognizes', async () => {
    const fixture = await buildFixtureWithExif()
    const meta = await sharp(fixture).metadata()
    expect(meta.exif).toBeDefined()
    expect(meta.exif.length).toBeGreaterThan(0)
  })
})

describe('transformDisplayImage strips sensitive EXIF metadata (regression, not assumption)', () => {
  it('output has NO EXIF segment at all — the strongest possible absence proof, covers GPS/camera/timestamp/every EXIF tag uniformly', async () => {
    const fixture = await buildFixtureWithExif()
    const output = await transformDisplayImage(fixture)
    const meta = await sharp(output).metadata()

    expect(meta.exif).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(meta.iptc).toBeUndefined()
    expect(meta.xmp).toBeUndefined()
  })

  it('output bytes do not contain the camera Make/Model/Software strings anywhere, independent of how sharp reports metadata', async () => {
    const fixture = await buildFixtureWithExif()
    const output = await transformDisplayImage(fixture)

    expect(output.includes(Buffer.from(FIXTURE_MAKE))).toBe(false)
    expect(output.includes(Buffer.from(FIXTURE_MODEL))).toBe(false)
    expect(output.includes(Buffer.from(FIXTURE_SOFTWARE))).toBe(false)
  })

  it('output bytes do not contain the capture-timestamp string', async () => {
    const fixture = await buildFixtureWithExif()
    const output = await transformDisplayImage(fixture)

    expect(output.includes(Buffer.from(FIXTURE_DATETIME))).toBe(false)
  })

  it('GPS is absent as a structural consequence of "no EXIF segment at all" (GPS is stored as binary-rational, not ASCII, so it cannot be string-searched directly)', async () => {
    const fixture = await buildFixtureWithExif()
    const output = await transformDisplayImage(fixture)
    const meta = await sharp(output).metadata()

    // The fixture's GPS tags live inside the same EXIF APP1 segment as the
    // Make/Model/DateTime tags proven present above (see "fixture carries a
    // real EXIF segment"). Proving that segment is entirely absent from the
    // output — already asserted above — necessarily proves GPS is absent
    // too, since there is no separate GPS-only mechanism in JPEG/EXIF for
    // it to survive through.
    expect(meta.exif).toBeUndefined()
  })

  it('.rotate() consumes the orientation tag before it is stripped — dimensions swap for a 90°-tagged source, and no orientation survives in the output', async () => {
    // 8x4 source tagged orientation=6 (rotate 90° CW to display correctly).
    // If .rotate() ran, the OUTPUT pixel dimensions are the rotated 4x8 (up
    // to the long-edge resize cap — both dimensions are far below
    // DISPLAY_MAX_LONG_EDGE here, so resize is a no-op and the swap is
    // directly observable).
    const fixture = await buildFixtureWithExif({ width: 8, height: 4, orientation: 6 })
    const output = await transformDisplayImage(fixture)
    const meta = await sharp(output).metadata()

    expect(meta.width).toBe(4)
    expect(meta.height).toBe(8)
    expect(meta.orientation).toBeUndefined()
  })

  it('produces a JPEG within the configured long-edge cap regardless of EXIF content', async () => {
    const fixture = await buildFixtureWithExif({ width: 20, height: 10 })
    const output = await transformDisplayImage(fixture)
    const meta = await sharp(output).metadata()

    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(DISPLAY_MAX_LONG_EDGE)
  })
})
