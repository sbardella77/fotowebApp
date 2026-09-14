/**
 * Tests for the Photo API DTO mapper (repository-mappers.js).
 *
 * Verifies the public/guest Photo response contract: fields that are
 * internal-only bookkeeping (uploadActorType, displayDerivativeStatus)
 * must never appear in any Photo object returned from the API, while
 * every other expected field is preserved unchanged.
 *
 * Guest EXIF Safe Delivery Cutover: normalizePhotoRecord/normalizeEventRecord
 * now default to guestSafe: true, which replaces `url` with
 * resolveGuestPhotoUrl(...) — the guest-safe derivative, or null for
 * anything not READY — instead of passing the original Photo.url through.
 * guestSafe: false (used only by the owner-authenticated
 * getEventBySlugAndOwner/listEventsByOwnerEmail repository paths) preserves
 * the original url exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { normalizePhotoRecord, normalizeEventRecord } from '@/lib/server/repository-mappers'

const VALID_DERIVATIVE_ORIGIN = 'https://store123.public.blob.vercel-storage.com'
const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  restoreEnv()
  process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN = VALID_DERIVATIVE_ORIGIN
})

afterEach(() => {
  restoreEnv()
})

function makeRawPhoto(overrides = {}) {
  return {
    id: 'photo-1',
    eventId: 'event-1',
    originalName: 'photo.jpg',
    storedName: 'stored-photo.jpg',
    mimeType: 'image/jpeg',
    size: 1024,
    url: 'https://abc.public.blob.vercel-storage.com/events/wedding-2026/photo.jpg',
    uploaderName: 'Alice',
    caption: 'Great shot',
    status: 'VISIBLE',
    momentId: null,
    contributorId: null,
    uploadActorType: 'guest',
    displayDerivativeStatus: 'READY',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }
}

describe('normalizePhotoRecord', () => {
  it('never includes displayDerivativeStatus in the returned DTO', () => {
    const dto = normalizePhotoRecord(makeRawPhoto())

    expect(dto).not.toHaveProperty('displayDerivativeStatus')
    expect(Object.keys(dto)).not.toContain('displayDerivativeStatus')
  })

  it('excludes displayDerivativeStatus regardless of its value', () => {
    for (const status of ['LEGACY_UNVERIFIED', 'PENDING', 'READY', 'FAILED']) {
      const dto = normalizePhotoRecord(makeRawPhoto({ displayDerivativeStatus: status }))
      expect(dto).not.toHaveProperty('displayDerivativeStatus')
    }
  })

  it('still excludes uploadActorType (pre-existing contract, regression guard)', () => {
    const dto = normalizePhotoRecord(makeRawPhoto())

    expect(dto).not.toHaveProperty('uploadActorType')
  })

  it('preserves every other expected Photo field unchanged (url is covered separately below — it is now guest-safe-resolved)', () => {
    const raw = makeRawPhoto()
    const dto = normalizePhotoRecord(raw)

    expect(dto).toMatchObject({
      id: raw.id,
      eventId: raw.eventId,
      originalName: raw.originalName,
      storedName: raw.storedName,
      mimeType: raw.mimeType,
      size: raw.size,
      uploaderName: raw.uploaderName,
      caption: raw.caption,
      status: raw.status,
      momentId: raw.momentId,
      contributorId: raw.contributorId,
    })
  })

  it('serializes createdAt/updatedAt to ISO strings', () => {
    const raw = makeRawPhoto()
    const dto = normalizePhotoRecord(raw)

    expect(dto.createdAt).toBe(raw.createdAt.toISOString())
    expect(dto.updatedAt).toBe(raw.updatedAt.toISOString())
  })
})

describe('normalizePhotoRecord — guestSafe url resolution (Guest EXIF Safe Delivery Cutover)', () => {
  it('defaults to guestSafe: true when no options are passed (fail closed)', () => {
    const dto = normalizePhotoRecord(makeRawPhoto({ displayDerivativeStatus: 'PENDING' }))
    expect(dto.url).toBeNull()
  })

  it('READY resolves to the derivative URL, never the original', () => {
    const raw = makeRawPhoto({ id: 'photo-ready', displayDerivativeStatus: 'READY' })
    const dto = normalizePhotoRecord(raw)

    expect(dto.url).toBe(`${VALID_DERIVATIVE_ORIGIN}/derivatives/display-v1/photo-ready.jpg`)
    expect(dto.url).not.toBe(raw.url)
  })

  it.each(['PENDING', 'FAILED', 'LEGACY_UNVERIFIED'])('%s resolves to null, never the original', (status) => {
    const raw = makeRawPhoto({ displayDerivativeStatus: status })
    const dto = normalizePhotoRecord(raw)

    expect(dto.url).toBeNull()
  })

  it('guestSafe: false preserves the original url regardless of status (owner/admin-authenticated path only)', () => {
    for (const status of ['LEGACY_UNVERIFIED', 'PENDING', 'READY', 'FAILED']) {
      const raw = makeRawPhoto({ displayDerivativeStatus: status })
      const dto = normalizePhotoRecord(raw, { guestSafe: false })
      expect(dto.url).toBe(raw.url)
    }
  })

  it('never exposes displayDerivativeStatus even when guestSafe: false', () => {
    const dto = normalizePhotoRecord(makeRawPhoto(), { guestSafe: false })
    expect(dto).not.toHaveProperty('displayDerivativeStatus')
  })
})

describe('normalizeEventRecord — photo list DTO', () => {
  it('excludes displayDerivativeStatus from every photo in a gallery listing', () => {
    const event = { id: 'event-1', slug: 'wedding-2026', createdAt: new Date(), updatedAt: new Date() }
    const photos = [makeRawPhoto({ id: 'p1' }), makeRawPhoto({ id: 'p2', displayDerivativeStatus: 'FAILED' })]

    const dto = normalizeEventRecord({ event, photos })

    expect(dto.photos).toHaveLength(2)
    for (const photo of dto.photos) {
      expect(photo).not.toHaveProperty('displayDerivativeStatus')
      expect(photo).not.toHaveProperty('uploadActorType')
    }
  })

  it('guestSafe defaults to true: a mixed-status photo list never exposes an original url for a non-READY photo', () => {
    const event = { id: 'event-1', slug: 'wedding-2026', createdAt: new Date(), updatedAt: new Date() }
    const photos = [
      makeRawPhoto({ id: 'p-ready', displayDerivativeStatus: 'READY' }),
      makeRawPhoto({ id: 'p-pending', displayDerivativeStatus: 'PENDING' }),
      makeRawPhoto({ id: 'p-failed', displayDerivativeStatus: 'FAILED' }),
      makeRawPhoto({ id: 'p-legacy', displayDerivativeStatus: 'LEGACY_UNVERIFIED' }),
    ]

    const dto = normalizeEventRecord({ event, photos })

    const byId = Object.fromEntries(dto.photos.map((p) => [p.id, p]))
    expect(byId['p-ready'].url).toBe(`${VALID_DERIVATIVE_ORIGIN}/derivatives/display-v1/p-ready.jpg`)
    expect(byId['p-pending'].url).toBeNull()
    expect(byId['p-failed'].url).toBeNull()
    expect(byId['p-legacy'].url).toBeNull()
    for (const photo of dto.photos) {
      expect(photo.url).not.toBe(photos.find((p) => p.id === photo.id).url)
    }
  })

  it('guestSafe: false (owner-authenticated path) preserves original urls for every status', () => {
    const event = { id: 'event-1', slug: 'wedding-2026', createdAt: new Date(), updatedAt: new Date() }
    const photos = [
      makeRawPhoto({ id: 'p-ready', displayDerivativeStatus: 'READY' }),
      makeRawPhoto({ id: 'p-failed', displayDerivativeStatus: 'FAILED' }),
    ]

    const dto = normalizeEventRecord({ event, photos, guestSafe: false })

    const byId = Object.fromEntries(dto.photos.map((p) => [p.id, p]))
    expect(byId['p-ready'].url).toBe(photos[0].url)
    expect(byId['p-failed'].url).toBe(photos[1].url)
  })
})
