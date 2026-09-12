/**
 * Tests for the Photo API DTO mapper (repository-mappers.js).
 *
 * Verifies the public/guest Photo response contract: fields that are
 * internal-only bookkeeping (uploadActorType, displayDerivativeStatus)
 * must never appear in any Photo object returned from the API, while
 * every other expected field is preserved unchanged.
 */

import { describe, it, expect } from 'vitest'
import { normalizePhotoRecord, normalizeEventRecord } from '@/lib/server/repository-mappers'

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

  it('preserves every other expected Photo field unchanged', () => {
    const raw = makeRawPhoto()
    const dto = normalizePhotoRecord(raw)

    expect(dto).toMatchObject({
      id: raw.id,
      eventId: raw.eventId,
      originalName: raw.originalName,
      storedName: raw.storedName,
      mimeType: raw.mimeType,
      size: raw.size,
      url: raw.url,
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
})
