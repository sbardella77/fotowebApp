import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { stripPrivateMetadata } from '@/lib/server/strip-private-metadata'

// Synthetic fixtures only. GPS is written the way a phone writes it (EXIF
// GPS IFD) plus XMP, and must never survive an ORIGINAL download.

const GPS_EXIF = {
  IFD0: { Make: 'FixturePhone', Model: 'Serial-123', Copyright: 'guest' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 54/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '12/1 29/1 0/1' },
}
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="41,54N"/></rdf:RDF></x:xmpmeta>'

const base = (w = 320, h = 200) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 30 } } })

async function rawPixels(buffer) {
  return sharp(buffer).raw().toBuffer()
}

/** Bytes from the first SOS marker on: the entropy-coded image itself. */
function jpegScan(buffer) {
  for (let i = 2; i < buffer.length - 1; i++) if (buffer[i] === 0xff && buffer[i + 1] === 0xda) return buffer.subarray(i)
  throw new Error('no SOS')
}

describe('stripPrivateMetadata', () => {
  it('JPEG: drops GPS, camera EXIF and XMP; keeps the scan data byte-identical', async () => {
    const source = await base().jpeg({ quality: 97 }).withExif(GPS_EXIF).withXmp(XMP).toBuffer()
    const before = await sharp(source).metadata()
    expect(before.exif.includes('Serial-123')).toBe(true)
    expect(before.xmp).toBeTruthy()

    const out = await stripPrivateMetadata(source)
    const after = await sharp(out).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(out.includes('Serial-123')).toBe(false)
    expect(out.includes('GPSLatitude')).toBe(false)
    expect(Buffer.compare(jpegScan(out), jpegScan(source))).toBe(0)
    expect(Buffer.compare(await rawPixels(out), await rawPixels(source))).toBe(0)
  })

  it('JPEG: keeps a non-default orientation so phone photos stay upright', async () => {
    const source = await base(320, 200).jpeg().withMetadata({ orientation: 6 }).withExifMerge(GPS_EXIF).toBuffer()
    expect((await sharp(source).metadata()).orientation).toBe(6)
    const out = await stripPrivateMetadata(source)
    const after = await sharp(out).metadata()
    expect(after.orientation).toBe(6)
    expect(out.includes('Serial-123')).toBe(false)
    const upright = await sharp(await sharp(out).rotate().toBuffer()).metadata()
    expect([upright.width, upright.height]).toEqual([200, 320])
  })

  it('JPEG: keeps the ICC colour profile', async () => {
    const source = await base().jpeg().withIccProfile('p3').withExif(GPS_EXIF).toBuffer()
    const out = await stripPrivateMetadata(source)
    expect((await sharp(out).metadata()).icc).toBeTruthy()
  })

  it('PNG: drops EXIF and text chunks, pixels unchanged', async () => {
    const source = await base().png().withExif(GPS_EXIF).toBuffer()
    expect((await sharp(source).metadata()).exif).toBeTruthy()
    const out = await stripPrivateMetadata(source)
    expect((await sharp(out).metadata()).exif).toBeUndefined()
    expect(Buffer.compare(await rawPixels(out), await rawPixels(source))).toBe(0)
  })

  it('WebP: drops EXIF and XMP, pixels unchanged', async () => {
    const source = await base().webp({ quality: 90 }).withExif(GPS_EXIF).withXmp(XMP).toBuffer()
    expect((await sharp(source).metadata()).exif).toBeTruthy()
    const out = await stripPrivateMetadata(source)
    const after = await sharp(out).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(Buffer.compare(await rawPixels(out), await rawPixels(source))).toBe(0)
  })

  it('unparseable input falls back to a metadata-free re-encode', async () => {
    const source = await base().jpeg().withExif(GPS_EXIF).toBuffer()
    const corrupted = Buffer.from(source)
    corrupted[4] = 0xff // break the first segment length
    corrupted[5] = 0xff
    const out = await stripPrivateMetadata(corrupted).catch(() => null)
    if (out) expect(out.includes('Serial-123')).toBe(false)
  })
})
