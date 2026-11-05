import { describe, it, expect, vi } from 'vitest'

// The public event queries include the owner relation only to resolve the
// photographer watermark. It carries plan/subscription data and must never
// reach a public event DTO (normalizeEventRecord spreads the whole event).
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

const { getPrismaClient } = await import('@/lib/server/prisma-client')
const { prismaGalleryRepository } = await import('@/lib/server/prisma-gallery-repository')

const OWNER = { plan: 'professional', subscriptionStatus: 'active', watermark: null }
const EVENT = { id: 'e1', slug: 's', name: 'n', ownerId: 'o1', createdAt: new Date(), updatedAt: new Date(), photos: [], moments: [], owner: OWNER }

describe('public event DTOs never expose the owner relation', () => {
  it('getEventBySlug and listEvents strip owner', async () => {
    getPrismaClient.mockResolvedValue({
      event: {
        findUnique: vi.fn().mockResolvedValue(EVENT),
        findMany: vi.fn().mockResolvedValue([{ ...EVENT, _count: { photos: 0 } }]),
      },
      photo: { count: vi.fn().mockResolvedValue(0) },
    })

    const event = await prismaGalleryRepository.getEventBySlug('s')
    const listed = await prismaGalleryRepository.listEvents()

    expect(event).not.toHaveProperty('owner')
    expect(listed[0]).not.toHaveProperty('owner')
    expect(JSON.stringify([event, listed])).not.toContain('subscriptionStatus')
  })
})
