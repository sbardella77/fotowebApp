import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import sharp from 'sharp'
import {
  resolveDownloadRepresentation,
  OriginalDownloadForbiddenError,
} from '@/lib/server/download-representation'
import { transformDisplayImage, DISPLAY_MAX_LONG_EDGE } from '@/lib/server/display-derivative'

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

async function sourceFixture() {
  // Synthetic 4000x3000 JPEG. No external/Production media is touched.
  return sharp({
    create: {
      width: 4000,
      height: 3000,
      channels: 3,
      background: { r: 80, g: 140, b: 210 },
    },
  })
    .jpeg({ quality: 96 })
    .withMetadata({ orientation: 1 })
    .toBuffer()
}

const photo = {
  id: 'photo-contract-fixture',
  url: 'https://fixture.invalid/source.jpg',
  mimeType: 'image/jpeg',
}

describe('Download Representation Contract v1', () => {
  it('STANDARD is a deterministic reduced JPEG and differs byte-for-byte from source', async () => {
    const source = await sourceFixture()
    const result = await resolveDownloadRepresentation({
      photo,
      requestedQuality: 'standard',
      access: { canDownloadOriginal: true },
      sourceLoader: async () => source,
      standardResolver: async ({ getSourceBuffer }) => transformDisplayImage(await getSourceBuffer()),
    })

    const metadata = await sharp(result.buffer).metadata()
    expect(result.representation).toBe('display-v1')
    expect(result.contentType).toBe('image/jpeg')
    expect(result.extension).toBe('.jpg')
    expect(Math.max(metadata.width, metadata.height)).toBe(DISPLAY_MAX_LONG_EDGE)
    expect(result.buffer.length).toBeLessThan(source.length)
    expect(sha256(result.buffer)).not.toBe(sha256(source))
    expect(metadata.exif).toBeUndefined()
  })

  it('ORIGINAL returns exact source bytes when entitled', async () => {
    const source = await sourceFixture()
    const result = await resolveDownloadRepresentation({
      photo,
      requestedQuality: 'original',
      access: { canDownloadOriginal: true },
      sourceLoader: async () => source,
      standardResolver: async () => { throw new Error('standard resolver must not run') },
    })

    expect(result.representation).toBe('source')
    expect(result.contentType).toBe('image/jpeg')
    expect(result.extension).toBeNull()
    expect(result.buffer.length).toBe(source.length)
    expect(sha256(result.buffer)).toBe(sha256(source))
  })

  it('ORIGINAL fails closed when entitlement is absent and never loads source', async () => {
    let sourceLoads = 0
    await expect(resolveDownloadRepresentation({
      photo,
      requestedQuality: 'original',
      access: { canDownloadOriginal: false },
      sourceLoader: async () => { sourceLoads += 1; return Buffer.from('forbidden') },
    })).rejects.toBeInstanceOf(OriginalDownloadForbiddenError)
    expect(sourceLoads).toBe(0)
  })

  it('unknown/missing quality normalizes to STANDARD, never ORIGINAL', async () => {
    const source = await sourceFixture()
    const result = await resolveDownloadRepresentation({
      photo,
      requestedQuality: 'unexpected',
      access: { canDownloadOriginal: true },
      sourceLoader: async () => source,
      standardResolver: async ({ getSourceBuffer }) => transformDisplayImage(await getSourceBuffer()),
    })
    expect(result.quality).toBe('standard')
    expect(result.representation).toBe('display-v1')
  })
})
