import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getDataAccessDriver: vi.fn().mockReturnValue('prisma'),
}))

import { getPrismaClient } from '@/lib/server/prisma-client'
import { prismaGalleryRepository, PhotographerLinkLimitError } from '@/lib/server/prisma-gallery-repository'

const EVENT_ID = 'event-1'

function makeFakePrisma({ links = [] } = {}) {
  const store = new Map(links.map((l) => [l.id, { ...l }]))
  let counter = 1
  return {
    photographerUploadLink: {
      count: vi.fn(async ({ where }) => {
        const now = new Date()
        return [...store.values()].filter((l) => {
          if (l.eventId !== where.eventId) return false
          if (l.revokedAt) return false
          if (l.expiresAt && new Date(l.expiresAt) <= now) return false
          return true
        }).length
      }),
      create: vi.fn(async ({ data }) => {
        const id = `link-${counter++}`
        const record = { id, revokedAt: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date(), ...data }
        store.set(id, record)
        return { ...record }
      }),
      findMany: vi.fn(async ({ where }) => {
        return [...store.values()]
          .filter((l) => l.eventId === where.eventId)
          .map((l) => ({ ...l, _count: { privateAssets: l._photoCount || 0 } }))
      }),
      findFirst: vi.fn(async ({ where }) => {
        const r = [...store.values()].find((l) => l.id === where.id && l.eventId === where.eventId)
        return r ? { ...r } : null
      }),
      update: vi.fn(async ({ where, data }) => {
        const r = store.get(where.id)
        Object.assign(r, data)
        return { ...r }
      }),
      findUnique: vi.fn(async ({ where }) => {
        const r = [...store.values()].find((l) => l.tokenHash === where.tokenHash)
        if (!r) return null
        const { event, ...rest } = r
        return { ...rest, event: event || { id: EVENT_ID, slug: 'wedding-2026' } }
      }),
    },
    _store: store,
  }
}

describe('prismaGalleryRepository — PhotographerUploadLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createPhotographerUploadLink creates a link with the given label', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const link = await prismaGalleryRepository.createPhotographerUploadLink(EVENT_ID, { tokenHash: 'hash-1', label: 'Mario' })

    expect(link.label).toBe('Mario')
    expect(link.eventId).toBe(EVENT_ID)
    expect(link.tokenHash).toBe('hash-1')
  })

  it('throws PhotographerLinkLimitError at the 11th active link for an event', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `link-existing-${i}`,
      eventId: EVENT_ID,
      tokenHash: `hash-existing-${i}`,
      label: null,
      revokedAt: null,
      expiresAt: null,
    }))
    const prisma = makeFakePrisma({ links: existing })
    getPrismaClient.mockResolvedValue(prisma)

    await expect(
      prismaGalleryRepository.createPhotographerUploadLink(EVENT_ID, { tokenHash: 'hash-11', label: null }),
    ).rejects.toThrow(PhotographerLinkLimitError)
  })

  it('a revoked link does not count toward the cap', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `link-existing-${i}`,
      eventId: EVENT_ID,
      tokenHash: `hash-existing-${i}`,
      label: null,
      revokedAt: i === 0 ? new Date() : null,
      expiresAt: null,
    }))
    const prisma = makeFakePrisma({ links: existing })
    getPrismaClient.mockResolvedValue(prisma)

    const link = await prismaGalleryRepository.createPhotographerUploadLink(EVENT_ID, { tokenHash: 'hash-11', label: null })
    expect(link.id).toBeDefined()
  })

  it('revokePhotographerUploadLink only revokes a link that belongs to the given event', async () => {
    const link = { id: 'link-1', eventId: EVENT_ID, tokenHash: 'hash-1', label: null, revokedAt: null, expiresAt: null }
    const prisma = makeFakePrisma({ links: [link] })
    getPrismaClient.mockResolvedValue(prisma)

    const result = await prismaGalleryRepository.revokePhotographerUploadLink('other-event', 'link-1')
    expect(result).toBeNull()

    const revoked = await prismaGalleryRepository.revokePhotographerUploadLink(EVENT_ID, 'link-1')
    expect(revoked.revokedAt).toBeInstanceOf(Date)
  })

  it('getPhotographerLinkByTokenHash returns null for an unknown token', async () => {
    const prisma = makeFakePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const result = await prismaGalleryRepository.getPhotographerLinkByTokenHash('unknown-hash')
    expect(result).toBeNull()
  })

  it('getPhotographerLinkByTokenHash returns null for a revoked link', async () => {
    const link = { id: 'link-1', eventId: EVENT_ID, tokenHash: 'hash-1', revokedAt: new Date(), expiresAt: null, event: { id: EVENT_ID, slug: 'wedding-2026' } }
    const prisma = makeFakePrisma({ links: [link] })
    getPrismaClient.mockResolvedValue(prisma)

    const result = await prismaGalleryRepository.getPhotographerLinkByTokenHash('hash-1')
    expect(result).toBeNull()
  })

  it('getPhotographerLinkByTokenHash returns null for an expired link', async () => {
    const link = { id: 'link-1', eventId: EVENT_ID, tokenHash: 'hash-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000), event: { id: EVENT_ID, slug: 'wedding-2026' } }
    const prisma = makeFakePrisma({ links: [link] })
    getPrismaClient.mockResolvedValue(prisma)

    const result = await prismaGalleryRepository.getPhotographerLinkByTokenHash('hash-1')
    expect(result).toBeNull()
  })

  it('getPhotographerLinkByTokenHash returns { event, link } for a live link', async () => {
    const link = { id: 'link-1', eventId: EVENT_ID, tokenHash: 'hash-1', revokedAt: null, expiresAt: null, event: { id: EVENT_ID, slug: 'wedding-2026' } }
    const prisma = makeFakePrisma({ links: [link] })
    getPrismaClient.mockResolvedValue(prisma)

    const result = await prismaGalleryRepository.getPhotographerLinkByTokenHash('hash-1')
    expect(result.event.slug).toBe('wedding-2026')
    expect(result.link.id).toBe('link-1')
    expect(result.link.event).toBeUndefined()
  })

  it('listPhotographerUploadLinks surfaces a photoCount derived from _count', async () => {
    const link = { id: 'link-1', eventId: EVENT_ID, tokenHash: 'hash-1', label: 'Mario', revokedAt: null, expiresAt: null, _photoCount: 3 }
    const prisma = makeFakePrisma({ links: [link] })
    getPrismaClient.mockResolvedValue(prisma)

    const links = await prismaGalleryRepository.listPhotographerUploadLinks(EVENT_ID)
    expect(links).toHaveLength(1)
    expect(links[0].photoCount).toBe(3)
    expect(links[0]._count).toBeUndefined()
  })
})
