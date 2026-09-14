import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Guest EXIF Safe Delivery Cutover — behavioral proof for the actual live
// guest+owner shared photo feed (getEventPhotosPaginated, backing
// GET /api/events/:slug/photos, which components/room-page-client.jsx
// polls for both the gallery grid and the lightbox). Structural/source
// checks for this function live in
// tests/guest-photo-url-consumer-inventory.test.js; this file proves the
// real return VALUES.

const VALID_ORIGIN = 'https://store123.public.blob.vercel-storage.com'
const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  restoreEnv()
  process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_ORIGIN
})

afterEach(() => {
  restoreEnv()
})

const ORIGINAL_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding/original-photo.jpg'

function makeRow(id, displayDerivativeStatus, overrides = {}) {
  return {
    id,
    originalName: `${id}.jpg`,
    storedName: `${id}-stored.jpg`,
    mimeType: 'image/jpeg',
    url: ORIGINAL_URL,
    displayDerivativeStatus,
    uploaderName: 'Alice',
    caption: '',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    momentId: null,
    ...overrides,
  }
}

describe('getEventPhotosPaginated — the live guest+owner shared photo feed', () => {
  it('READY exposes the derivative URL; PENDING/FAILED/LEGACY_UNVERIFIED expose null, never the original', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server/prisma-client', () => ({
      getPrismaClient: vi.fn(async () => ({
        photo: {
          findMany: vi.fn(async () => [
            makeRow('p-ready', 'READY'),
            makeRow('p-pending', 'PENDING'),
            makeRow('p-failed', 'FAILED'),
            makeRow('p-legacy', 'LEGACY_UNVERIFIED'),
          ]),
          count: vi.fn(async () => 4),
        },
      })),
    }))

    const { prismaGalleryRepository } = await import('@/lib/server/prisma-gallery-repository')
    const result = await prismaGalleryRepository.getEventPhotosPaginated({ eventId: 'event-1' })

    expect(result.photos).toHaveLength(4)
    const byId = Object.fromEntries(result.photos.map((p) => [p.id, p]))

    expect(byId['p-ready'].url).toBe(`${VALID_ORIGIN}/derivatives/display-v1/p-ready.jpg`)
    expect(byId['p-ready'].url).not.toBe(ORIGINAL_URL)
    expect(byId['p-pending'].url).toBeNull()
    expect(byId['p-failed'].url).toBeNull()
    expect(byId['p-legacy'].url).toBeNull()

    // No returned photo ever carries displayDerivativeStatus.
    for (const photo of result.photos) {
      expect(photo).not.toHaveProperty('displayDerivativeStatus')
    }

    vi.doUnmock('@/lib/server/prisma-client')
  })

  it('never returns the original URL for any non-READY status, even under a misconfigured derivative origin', async () => {
    delete process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
    vi.resetModules()
    vi.doMock('@/lib/server/prisma-client', () => ({
      getPrismaClient: vi.fn(async () => ({
        photo: {
          findMany: vi.fn(async () => [makeRow('p-ready', 'READY')]),
          count: vi.fn(async () => 1),
        },
      })),
    }))

    const { prismaGalleryRepository } = await import('@/lib/server/prisma-gallery-repository')
    const result = await prismaGalleryRepository.getEventPhotosPaginated({ eventId: 'event-1' })

    // Even a READY photo degrades to null (not the original) when the
    // derivative origin itself is misconfigured — fail closed, not fail
    // open to the source.
    expect(result.photos[0].url).toBeNull()
    expect(result.photos[0].url).not.toBe(ORIGINAL_URL)

    vi.doUnmock('@/lib/server/prisma-client')
  })
})
