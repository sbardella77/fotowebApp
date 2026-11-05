import { describe, it, expect, vi } from 'vitest'
import { runWatermarkRegeneration } from '@/lib/server/watermark-regeneration'
import { computeWatermarkRevision } from '@/lib/server/photographer-watermark-config'

function makeOwner(overrides = {}) {
  const watermark = { enabled: true, type: 'text', text: 'Studio', logoUrl: null, logoSha256: null, position: 'bottom-right', opacityPercent: 60, sizePercent: 20 }
  watermark.revision = computeWatermarkRevision(watermark)
  return { plan: 'professional', subscriptionStatus: 'active', watermark, ...overrides }
}

/**
 * Fake prisma: photos are "pending" until the ensure double marks them done,
 * mirroring how the real query excludes rows already at the revision.
 */
function makePrisma({ pending, photosByOwner }) {
  const done = new Set()
  return {
    done,
    ownerWatermark: {
      findMany: vi.fn(async () => pending),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    photo: {
      findMany: vi.fn(async ({ where, take }) => {
        const excluded = new Set(where.id?.notIn || [])
        return (photosByOwner[where.event.ownerId] || [])
          .filter((p) => !done.has(p.id) && !excluded.has(p.id))
          .slice(0, take)
      }),
    },
  }
}

const photos = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, url: `u${i}`, mediaType: 'IMAGE' }))

describe('runWatermarkRegeneration', () => {
  it('renders every pending photo of a PENDING owner, then marks it IDLE', async () => {
    const owner = makeOwner()
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner }], photosByOwner: { o1: photos('p', 5) } })
    const ensure = vi.fn(async ({ photo }) => { prisma.done.add(photo.id); return { ok: true, created: true } })

    const stats = await runWatermarkRegeneration({ prisma, ensure })

    expect(stats).toMatchObject({ owners: 1, ownersCompleted: 1, processed: 5, failed: 0, budgetExhausted: false })
    expect(ensure).toHaveBeenCalledTimes(5)
    expect(ensure.mock.calls[0][0].spec.revision).toBe(owner.watermark.revision)
    expect(prisma.ownerWatermark.updateMany).toHaveBeenCalledWith({
      where: { ownerId: 'o1', revision: owner.watermark.revision },
      data: expect.objectContaining({ regenState: 'IDLE' }),
    })
  })

  it('queries newest first, only visible READY images not at the current revision', async () => {
    const owner = makeOwner()
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner }], photosByOwner: { o1: [] } })
    await runWatermarkRegeneration({ prisma, ensure: vi.fn() })
    const query = prisma.photo.findMany.mock.calls[0][0]
    expect(query.orderBy).toEqual({ createdAt: 'desc' })
    expect(query.where).toMatchObject({ event: { ownerId: 'o1' }, status: 'VISIBLE', mediaType: 'IMAGE', displayDerivativeStatus: 'READY' })
    expect(query.where.OR).toEqual([{ watermarkDisplayRevision: null }, { watermarkDisplayRevision: { not: owner.watermark.revision } }])
  })

  it('an owner with no active watermark (lapsed plan) is set IDLE without rendering', async () => {
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner: makeOwner({ subscriptionStatus: 'canceled' }) }], photosByOwner: { o1: photos('p', 3) } })
    const ensure = vi.fn()
    const stats = await runWatermarkRegeneration({ prisma, ensure })
    expect(stats.ownersSkipped).toBe(1)
    expect(ensure).not.toHaveBeenCalled()
    expect(prisma.ownerWatermark.updateMany).toHaveBeenCalledWith({ where: { ownerId: 'o1' }, data: { regenState: 'IDLE' } })
  })

  it('a failing photo is not retried in the same run and keeps the owner PENDING', async () => {
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner: makeOwner() }], photosByOwner: { o1: photos('p', 3) } })
    const ensure = vi.fn(async ({ photo }) => {
      if (photo.id === 'p1') return { ok: false, created: false }
      prisma.done.add(photo.id)
      return { ok: true, created: true }
    })
    const stats = await runWatermarkRegeneration({ prisma, ensure })
    expect(stats).toMatchObject({ processed: 2, failed: 1, ownersCompleted: 0 })
    expect(ensure).toHaveBeenCalledTimes(3)
    expect(prisma.ownerWatermark.updateMany).not.toHaveBeenCalled()
  })

  it('stops at maxPhotos without marking the owner IDLE', async () => {
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner: makeOwner() }], photosByOwner: { o1: photos('p', 10) } })
    const ensure = vi.fn(async ({ photo }) => { prisma.done.add(photo.id); return { ok: true, created: true } })
    const stats = await runWatermarkRegeneration({ prisma, ensure, maxPhotos: 4, concurrency: 2 })
    expect(stats).toMatchObject({ processed: 4, budgetExhausted: true, ownersCompleted: 0 })
    expect(prisma.ownerWatermark.updateMany).not.toHaveBeenCalled()
  })

  it('stops when the time budget runs out', async () => {
    let clock = 0
    const prisma = makePrisma({ pending: [{ ownerId: 'o1', owner: makeOwner() }], photosByOwner: { o1: photos('p', 10) } })
    const ensure = vi.fn(async ({ photo }) => { clock += 100; prisma.done.add(photo.id); return { ok: true, created: true } })
    const stats = await runWatermarkRegeneration({ prisma, ensure, now: () => clock, budgetMs: 250, concurrency: 1 })
    expect(stats.budgetExhausted).toBe(true)
    expect(stats.processed).toBe(3)
  })

  it('nothing pending → no photo queries', async () => {
    const prisma = makePrisma({ pending: [], photosByOwner: {} })
    const stats = await runWatermarkRegeneration({ prisma, ensure: vi.fn() })
    expect(stats.owners).toBe(0)
    expect(prisma.photo.findMany).not.toHaveBeenCalled()
  })
})
