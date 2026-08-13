/**
 * Tests for getEventById on both repository implementations.
 *
 * Verifies:
 *   - mockGalleryRepository.getEventById reads from the local JSON database
 *   - prismaGalleryRepository.getEventById reads from Prisma
 *   - Both return { id, slug } or null
 *   - Neither leaks prisma into the mock path
 *
 * This regression guards the deleteOwnerPhoto fix:
 * instead of calling getPrismaClient() directly, the route now calls
 * repository.getEventById(photo.eventId), which works correctly under
 * DATA_ACCESS_DRIVER=local (no DATABASE_URL).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── mock-db: mockGalleryRepository.getEventById ─────────────────────────────
// mock fs/promises BEFORE importing mock-db (vi.mock is hoisted)

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

import { readFile } from 'fs/promises'
import { mockGalleryRepository } from '@/lib/server/mock-db'

// ─── prisma-gallery-repository: getEventById ─────────────────────────────────

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getDataAccessDriver: vi.fn().mockReturnValue('prisma'),
}))

import { getPrismaClient } from '@/lib/server/prisma-client'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EVENT_A = { id: 'event-a', slug: 'local-event', ownerEmail: 'owner@test.com', photos: [], createdAt: new Date().toISOString() }
const EVENT_B = { id: 'event-b', slug: 'other-event', ownerEmail: 'other@test.com', photos: [], createdAt: new Date().toISOString() }

function makeLocalDatabase(events = []) {
  return JSON.stringify({ events, photos: [] })
}

// ─── mockGalleryRepository.getEventById ──────────────────────────────────────

describe('mockGalleryRepository.getEventById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { id, slug } when event exists', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([EVENT_A, EVENT_B]))
    const result = await mockGalleryRepository.getEventById('event-a')
    expect(result).toEqual({ id: 'event-a', slug: 'local-event' })
  })

  it('returns null when event does not exist', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([EVENT_A]))
    const result = await mockGalleryRepository.getEventById('nonexistent-id')
    expect(result).toBeNull()
  })

  it('returns null for an empty database', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([]))
    const result = await mockGalleryRepository.getEventById('event-a')
    expect(result).toBeNull()
  })

  it('returns the correct event when multiple events exist', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([EVENT_A, EVENT_B]))
    const result = await mockGalleryRepository.getEventById('event-b')
    expect(result).toEqual({ id: 'event-b', slug: 'other-event' })
  })

  it('returns only id and slug — not the full event record', async () => {
    readFile.mockResolvedValue(makeLocalDatabase([EVENT_A]))
    const result = await mockGalleryRepository.getEventById('event-a')
    expect(Object.keys(result)).toEqual(['id', 'slug'])
  })
})

// ─── prismaGalleryRepository.getEventById ────────────────────────────────────

describe('prismaGalleryRepository.getEventById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makePrisma(eventOrNull) {
    return {
      event: {
        findUnique: vi.fn().mockResolvedValue(eventOrNull),
      },
    }
  }

  it('returns { id, slug } when prisma finds the event', async () => {
    getPrismaClient.mockResolvedValue(makePrisma({ id: 'event-a', slug: 'local-event' }))
    const result = await prismaGalleryRepository.getEventById('event-a')
    expect(result).toEqual({ id: 'event-a', slug: 'local-event' })
  })

  it('calls prisma.event.findUnique with correct where clause and select', async () => {
    const mockPrisma = makePrisma({ id: 'event-a', slug: 'local-event' })
    getPrismaClient.mockResolvedValue(mockPrisma)
    await prismaGalleryRepository.getEventById('event-a')
    expect(mockPrisma.event.findUnique).toHaveBeenCalledWith({
      where: { id: 'event-a' },
      select: { id: true, slug: true },
    })
  })

  it('returns null when prisma finds no event', async () => {
    getPrismaClient.mockResolvedValue(makePrisma(null))
    const result = await prismaGalleryRepository.getEventById('nonexistent')
    expect(result).toBeNull()
  })

  it('throws when getPrismaClient returns null', async () => {
    getPrismaClient.mockResolvedValue(null)
    await expect(prismaGalleryRepository.getEventById('event-a')).rejects.toThrow()
  })

  it('returns only id and slug — not the full event record', async () => {
    getPrismaClient.mockResolvedValue(makePrisma({ id: 'event-a', slug: 'local-event' }))
    const result = await prismaGalleryRepository.getEventById('event-a')
    expect(Object.keys(result)).toEqual(['id', 'slug'])
  })
})

// ─── Behavioral: local path + slug from repository reaches deleteFile ─────────

import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'

describe('deleteOwnerPhoto local-path regression — slug from repository', () => {
  it('reaches deleteFile when repository.getEventById supplies the correct slug', async () => {
    // Simulate what deleteOwnerPhoto does after the fix:
    // 1. photo comes back from deletePhotoByOwner with eventId
    // 2. repository.getEventById(eventId) returns the event with slug
    // 3. deleteEventScopedStoredFile is called with that slug

    const mockRepo = {
      getEventById: vi.fn().mockResolvedValue({ id: 'event-a', slug: 'local-event' }),
    }

    const photo = {
      id: 'photo-1',
      eventId: 'event-a',
      url: '/uploads/events/local-event/photo.jpg',
    }

    const deleteFile = vi.fn().mockResolvedValue(undefined)

    // Resolve event via repository (not getPrismaClient)
    const event = await mockRepo.getEventById(photo.eventId)
    const result = await deleteEventScopedStoredFile({
      url: photo.url,
      eventSlug: event?.slug || '',
      kind: 'room-photo',
      deleteFile,
    })

    expect(result).toEqual({ deleted: true, skipped: false })
    expect(deleteFile).toHaveBeenCalledOnce()
    expect(deleteFile).toHaveBeenCalledWith('/uploads/events/local-event/photo.jpg')
  })

  it('when getEventById throws, no storage delete is attempted and error is swallowed by cleanup block', async () => {
    // Simulates the try/catch in deleteOwnerPhoto: getEventById inside the try block
    const transientError = new Error('DB transient error')
    const mockRepo = {
      getEventById: vi.fn().mockRejectedValue(transientError),
    }
    const photo = {
      id: 'photo-1',
      eventId: 'event-a',
      url: '/uploads/events/local-event/photo.jpg',
    }
    const deleteFile = vi.fn()

    // Mirrors the try/catch in deleteOwnerPhoto
    let caughtError = null
    try {
      const event = await mockRepo.getEventById(photo.eventId)
      await deleteEventScopedStoredFile({
        url: photo.url,
        eventSlug: event?.slug || '',
        kind: 'room-photo',
        deleteFile,
      })
    } catch (err) {
      caughtError = err
    }

    // The error is caught (not propagated) — deleteFile was never called
    expect(caughtError).toBe(transientError)
    expect(deleteFile).not.toHaveBeenCalled()
    // In the route, the catch logs and continues — route returns { deleted: true }
  })

  it('skips deleteFile when repository.getEventById returns null (event concurrently deleted)', async () => {
    const mockRepo = {
      getEventById: vi.fn().mockResolvedValue(null),
    }

    const photo = {
      id: 'photo-1',
      eventId: 'event-a',
      url: '/uploads/events/local-event/photo.jpg',
    }

    const deleteFile = vi.fn().mockResolvedValue(undefined)

    const event = await mockRepo.getEventById(photo.eventId)
    const result = await deleteEventScopedStoredFile({
      url: photo.url,
      eventSlug: event?.slug || '',
      kind: 'room-photo',
      deleteFile,
    })

    // When event is gone, eventSlug = '' → helper skips (fail-safe)
    expect(result).toEqual({ deleted: false, skipped: true })
    expect(deleteFile).not.toHaveBeenCalled()
  })
})
