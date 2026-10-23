import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

const { getPrismaClient, sendOpsAlert } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
  sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert }))

import { GET } from '@/app/api/cron/mark-expired-events/route'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, CRON_SECRET: 'cron_secret_test' }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest(secret = 'cron_secret_test') {
  return {
    headers: {
      get: vi.fn((name) => (name.toLowerCase() === 'authorization' ? `Bearer ${secret}` : null)),
    },
  }
}

function buildPrisma(events) {
  return {
    event: {
      findMany: vi.fn().mockResolvedValue(events),
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function freeEvent(overrides = {}) {
  return {
    id: 'event_1',
    slug: 'wedding-2025',
    billingTier: null,
    archiveLocked: false,
    vaultExtendedUntil: null,
    gracePeriodUntil: null,
    expiredAt: null,
    owner: { id: 'owner_1', plan: 'free', subscriptionCanceledAt: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sendOpsAlert.mockResolvedValue({ sent: true })
})

describe('GET /api/cron/mark-expired-events', () => {
  it('rejects a request with a wrong bearer token', async () => {
    const response = await GET(createRequest('wrong-secret'))
    expect(response.status).toBe(401)
  })

  it('returns 503 when the database is unavailable', async () => {
    getPrismaClient.mockResolvedValue(null)
    const response = await GET(createRequest())
    expect(response.status).toBe(503)
  })

  it('marks a Free event past its 90-day retention as expired', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-100) })
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.marked).toBe(1)
    expect(body.unmarked).toBe(0)
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { expiredAt: expect.any(Date) },
    })
  })

  it('does not re-mark an event that is already flagged expired', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-100), expiredAt: new Date() })
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.marked).toBe(0)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('clears expiredAt when a previously-expired event is no longer expired', async () => {
    const event = freeEvent({
      createdAt: daysFromNow(-100),
      expiredAt: new Date(),
      billingTier: 'pro_event', // now covered for 12 months, no longer expired
    })
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.unmarked).toBe(1)
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { expiredAt: null },
    })
  })

  it('never queries events with archiveLocked: true (excluded at the query level)', async () => {
    const prisma = buildPrisma([])
    getPrismaClient.mockResolvedValue(prisma)

    await GET(createRequest())

    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archiveLocked: false } }),
    )
  })

  it('a failure on one event does not stop the others', async () => {
    const eventA = freeEvent({ id: 'event_a', createdAt: daysFromNow(-100) })
    const eventB = freeEvent({ id: 'event_b', createdAt: daysFromNow(-100) })
    const prisma = buildPrisma([eventA, eventB])
    prisma.event.update = vi.fn()
      .mockRejectedValueOnce(new Error('db blew up'))
      .mockResolvedValueOnce({})
    getPrismaClient.mockResolvedValue(prisma)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.scanned).toBe(2)
    expect(body.marked).toBe(1)
  })

  it('run-level failure returns 500 and sends exactly one ops alert', async () => {
    const prisma = { event: { findMany: vi.fn().mockRejectedValue(new Error('db unreachable')), update: vi.fn() } }
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Mark-expired-events run failed')
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    expect(sendOpsAlert.mock.calls[0][0].type).toBe('ops:cron:mark_expired_events_failed')
  })

  it('never deletes or mutates Photo/PrivateAsset/blob storage — only the Event.expiredAt flag', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-100) })
    const prisma = buildPrisma([event])
    prisma.photo = { delete: vi.fn(), deleteMany: vi.fn() }
    prisma.privateAsset = { delete: vi.fn(), deleteMany: vi.fn() }
    getPrismaClient.mockResolvedValue(prisma)

    await GET(createRequest())

    expect(prisma.photo.delete).not.toHaveBeenCalled()
    expect(prisma.photo.deleteMany).not.toHaveBeenCalled()
    expect(prisma.privateAsset.delete).not.toHaveBeenCalled()
    expect(prisma.privateAsset.deleteMany).not.toHaveBeenCalled()
  })
})
