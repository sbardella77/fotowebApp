import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }) }))

import { GET } from '@/app/api/cron/check-billing-health/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

const originalEnv = process.env

beforeAll(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    CRON_SECRET: 'cron_secret_test',
  }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest(secret = 'cron_secret_test') {
  return {
    headers: {
      get: vi.fn((name) => {
        if (name.toLowerCase() === 'authorization') return `Bearer ${secret}`
        if (name.toLowerCase() === 'x-cron-secret') return null
        return null
      }),
    },
  }
}

function createPrismaMock(overrides = {}) {
  return {
    extraFreeEventCheckout: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    galleryDownloadJob: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    owner: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(createPrismaMock())
})

describe('GET /api/cron/check-billing-health', () => {
  it('returns 401 when CRON_SECRET is missing', async () => {
    const response = await GET(createRequest('wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 503 when database is unavailable', async () => {
    getPrismaClient.mockResolvedValue(null)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe('Database unavailable')
  })

  it('returns empty summary when no issues are found', async () => {
    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.issueCount).toBe(0)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('reports stuck checkout_created records and sends an alert', async () => {
    const prisma = createPrismaMock({
      extraFreeEventCheckout: {
        findMany: vi.fn().mockImplementation(({ where }) => {
          if (where.status === 'checkout_created') {
            return [
              { id: 'pending-1', ownerId: 'owner-1', status: 'checkout_created', stripeCheckoutSessionId: 'cs_test', updatedAt: new Date() },
            ]
          }
          return []
        }),
      },
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.issueCount).toBe(1)
    expect(body.issues[0].type).toBe('extra_free_event:stuck_checkout_created')
    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        type: 'ops:cron:billing_health_issues',
      })
    )
  })

  it('reports failed gallery jobs and past_due subscriptions', async () => {
    const prisma = createPrismaMock({
      galleryDownloadJob: {
        findMany: vi.fn().mockImplementation(({ where }) => {
          if (where.status?.in) return []
          if (where.status === 'FAILED') {
            return [{ id: 'job-1', eventId: 'event-1', status: 'FAILED', error: 'blob missing', updatedAt: new Date() }]
          }
          return []
        }),
      },
      owner: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'owner-1', email: 'owner@example.com', subscriptionStatus: 'past_due', subscriptionGraceUntil: new Date(Date.now() - 3600000) },
        ]),
      },
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.issueCount).toBe(2)
    const types = body.issues.map((i) => i.type)
    expect(types).toContain('gallery_job:failed')
    expect(types).toContain('subscription:past_due_grace_expired')
  })

  it('sends critical alert when health check query fails', async () => {
    const prisma = createPrismaMock({
      extraFreeEventCheckout: {
        findMany: vi.fn().mockRejectedValue(new Error('DB timeout')),
      },
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        type: 'ops:cron:billing_health_query_failed',
      })
    )
  })
})
