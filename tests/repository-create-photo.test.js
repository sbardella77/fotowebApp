/**
 * Tests for createPhoto's contributorId propagation on both repository
 * implementations (BILLING/contributor-id server contract PR).
 *
 * Verifies:
 *   - prismaGalleryRepository.createPhoto persists a provided contributorId
 *   - legacy call sites (contributorId omitted) still succeed, contributorId null
 *   - mockGalleryRepository.createPhoto has the same contract
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getDataAccessDriver: vi.fn().mockReturnValue('prisma'),
}))

import { getPrismaClient } from '@/lib/server/prisma-client'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  appendFile: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, writeFile } from 'fs/promises'
import { mockGalleryRepository } from '@/lib/server/mock-db'

const BASE_INPUT = {
  eventId: 'event-1',
  originalName: 'photo.jpg',
  storedName: 'stored-photo.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
  url: 'https://abc.public.blob.vercel-storage.com/events/wedding-2026/photo.jpg',
}

function makeFakePrisma() {
  return {
    photo: {
      create: vi.fn(async ({ data }) => ({ id: 'photo-1', createdAt: new Date(), updatedAt: new Date(), ...data })),
      findFirst: vi.fn(async () => null),
    },
    event: {
      update: vi.fn(async () => ({})),
    },
  }
}

describe('prismaGalleryRepository.createPhoto — contributorId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a provided contributorId', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const photo = await prismaGalleryRepository.createPhoto({
      ...BASE_INPUT,
      contributorId: '55555555-5555-4555-8555-555555555555',
    })

    expect(photo.contributorId).toBe('55555555-5555-4555-8555-555555555555')
    expect(prisma.photo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contributorId: '55555555-5555-4555-8555-555555555555' }) }),
    )
  })

  it('legacy call site without contributorId still succeeds, persists null', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const photo = await prismaGalleryRepository.createPhoto({ ...BASE_INPUT })

    expect(photo.contributorId).toBeNull()
    expect(prisma.photo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contributorId: null }) }),
    )
  })
})

describe('prismaGalleryRepository.createPhoto — uploadActorType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists a provided uploadActorType to the database, but never exposes it on the returned DTO (Phase 14 privacy rule)', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const photo = await prismaGalleryRepository.createPhoto({
      ...BASE_INPUT,
      uploadActorType: 'owner',
    })

    expect(prisma.photo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ uploadActorType: 'owner' }) }),
    )
    // normalizePhotoRecord strips uploadActorType — it's server-only
    // attribution metadata, never part of the public Photo API surface.
    expect(photo.uploadActorType).toBeUndefined()
  })

  it('legacy/anonymous call site without uploadActorType still succeeds, persists null to the database', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const photo = await prismaGalleryRepository.createPhoto({ ...BASE_INPUT })

    expect(prisma.photo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ uploadActorType: null }) }),
    )
    expect(photo.uploadActorType).toBeUndefined()
  })
})

describe('mockGalleryRepository.createPhoto — contributorId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeLocalDatabase() {
    return JSON.stringify({
      events: [{ id: 'event-1', slug: 'wedding-2026', photos: [] }],
      photos: [],
    })
  }

  it('persists a provided contributorId', async () => {
    readFile.mockResolvedValue(makeLocalDatabase())

    const photo = await mockGalleryRepository.createPhoto({
      ...BASE_INPUT,
      contributorId: '55555555-5555-4555-8555-555555555555',
    })

    expect(photo.contributorId).toBe('55555555-5555-4555-8555-555555555555')
  })

  it('legacy call site without contributorId still succeeds, persists null', async () => {
    readFile.mockResolvedValue(makeLocalDatabase())

    const photo = await mockGalleryRepository.createPhoto({ ...BASE_INPUT })

    expect(photo.contributorId).toBeNull()
  })
})

describe('mockGalleryRepository.createPhoto — uploadActorType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function makeLocalDatabase() {
    return JSON.stringify({
      events: [{ id: 'event-1', slug: 'wedding-2026', photos: [] }],
      photos: [],
    })
  }

  // mockGalleryRepository (the local-JSON DATA_ACCESS_DRIVER, dev-only —
  // Preview/Production always run Prisma) does not route through
  // normalizePhotoRecord, so uploadActorType is present on its returned
  // object exactly like contributorId already is in this driver — this is
  // pre-existing, unrelated behavior, not something this change alters.
  it('persists a provided uploadActorType', async () => {
    readFile.mockResolvedValue(makeLocalDatabase())

    const photo = await mockGalleryRepository.createPhoto({
      ...BASE_INPUT,
      uploadActorType: 'guest',
    })

    expect(photo.uploadActorType).toBe('guest')
  })

  it('legacy/anonymous call site without uploadActorType still succeeds, persists null', async () => {
    readFile.mockResolvedValue(makeLocalDatabase())

    const photo = await mockGalleryRepository.createPhoto({ ...BASE_INPUT })

    expect(photo.uploadActorType).toBeNull()
  })
})
