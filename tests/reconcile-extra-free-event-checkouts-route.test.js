import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// BILLING PR 2A — route-level auth/dispatch/response-shape tests. The
// classifier's own classification behavior is exhaustively tested in
// tests/extra-free-event-reconciliation.test.js; this file mocks it and
// focuses purely on the route's responsibilities: auth, wiring, and
// returning the aggregate verbatim with no additional record-level data.

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/extra-free-event-reconciliation', () => ({
  inspectExtraFreeEventCheckouts: vi.fn(),
}))

import { GET } from '@/app/api/cron/reconcile-extra-free-event-checkouts/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { inspectExtraFreeEventCheckouts } from '@/lib/server/extra-free-event-reconciliation'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test', CRON_SECRET: 'cron_secret_test' }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest({ secret = 'cron_secret_test', headerName = 'authorization' } = {}) {
  return {
    headers: {
      get: vi.fn((name) => {
        const lower = name.toLowerCase()
        if (headerName === 'authorization' && lower === 'authorization') return `Bearer ${secret}`
        if (headerName === 'x-cron-secret' && lower === 'x-cron-secret') return secret
        return null
      }),
    },
  }
}

const AGGREGATE_STUB = {
  mode: 'dry-run',
  checked: 3,
  openUnpaid: 1,
  expiredUnpaid: 1,
  completePaidLocalUnfulfilled: 0,
  completePaidLocalFulfilled: 0,
  completeUnpaidOrPending: 1,
  unexpected: 0,
  stripeRetrieveFailed: 0,
  localAmbiguous: 0,
  completeUnpaidOrPendingBreakdown: {
    paymentIntentProcessing: 0,
    paymentIntentRequiresPaymentMethod: 0,
    paymentIntentCanceled: 0,
    paymentIntentSucceeded: 0,
    paymentIntentOther: 0,
    paymentIntentUnavailable: 1,
  },
  candidateCount: 3,
  oldestAgeMinutes: 200,
  newestAgeMinutes: 65,
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue({ extraFreeEventCheckout: { findMany: vi.fn() } })
  getStripe.mockReturnValue({ checkout: { sessions: { retrieve: vi.fn() } }, paymentIntents: { retrieve: vi.fn() } })
  inspectExtraFreeEventCheckouts.mockResolvedValue(AGGREGATE_STUB)
})

describe('GET /api/cron/reconcile-extra-free-event-checkouts — auth', () => {
  it('rejects a missing/wrong CRON_SECRET with 401, never invokes the classifier', async () => {
    const response = await GET(createRequest({ secret: 'wrong' }))
    expect(response.status).toBe(401)
    expect(inspectExtraFreeEventCheckouts).not.toHaveBeenCalled()
  })

  it('rejects a request with no auth header at all', async () => {
    const request = { headers: { get: vi.fn(() => null) } }
    const response = await GET(request)
    expect(response.status).toBe(401)
    expect(inspectExtraFreeEventCheckouts).not.toHaveBeenCalled()
  })

  it('accepts Authorization: Bearer <CRON_SECRET>', async () => {
    const response = await GET(createRequest({ headerName: 'authorization' }))
    expect(response.status).toBe(200)
    expect(inspectExtraFreeEventCheckouts).toHaveBeenCalledTimes(1)
  })

  it('accepts X-Cron-Secret: <CRON_SECRET> (existing project convention)', async () => {
    const response = await GET(createRequest({ headerName: 'x-cron-secret' }))
    expect(response.status).toBe(200)
    expect(inspectExtraFreeEventCheckouts).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/reconcile-extra-free-event-checkouts — dry-run response', () => {
  it('returns the aggregate verbatim, mode=dry-run, no record list, no ids', async () => {
    const response = await GET(createRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.mode).toBe('dry-run')
    expect(body).toEqual(AGGREGATE_STUB)
    expect(body.records).toBeUndefined()
    expect(body.ids).toBeUndefined()
    expect(body.candidates).toBeUndefined()
  })

  it('wires prisma and stripe into the classifier', async () => {
    const prisma = { extraFreeEventCheckout: { findMany: vi.fn() } }
    const stripe = { checkout: { sessions: { retrieve: vi.fn() } } }
    getPrismaClient.mockResolvedValue(prisma)
    getStripe.mockReturnValue(stripe)

    await GET(createRequest())

    expect(inspectExtraFreeEventCheckouts).toHaveBeenCalledWith(expect.objectContaining({ prisma, stripe }))
  })
})

describe('GET /api/cron/reconcile-extra-free-event-checkouts — infrastructure failure', () => {
  it('database unavailable → 503, classifier never invoked', async () => {
    getPrismaClient.mockResolvedValue(null)
    const response = await GET(createRequest())
    expect(response.status).toBe(503)
    expect(inspectExtraFreeEventCheckouts).not.toHaveBeenCalled()
  })

  it('Stripe unavailable (getStripe throws) → 503, no partial/fabricated result, classifier never invoked', async () => {
    getStripe.mockImplementation(() => {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    })
    const response = await GET(createRequest())
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.mode).toBeUndefined()
    expect(inspectExtraFreeEventCheckouts).not.toHaveBeenCalled()
  })

  it('classifier throwing an unexpected error → 500, no secrets/raw error in response', async () => {
    inspectExtraFreeEventCheckouts.mockRejectedValue(new Error('unexpected internal failure with sensitive detail'))
    const response = await GET(createRequest())
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('sensitive detail')
  })
})
