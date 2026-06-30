import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createCsrfToken } from '@/lib/server/csrf'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/owner-auth', () => ({ verifyOwnerSessionToken: vi.fn() }))
vi.mock('@/lib/server/owner-resolution', () => ({ resolveCanonicalOwner: vi.fn() }))

import { POST } from '@/app/api/stripe/customer-portal/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'

const originalEnv = process.env

beforeAll(() => {
  process.env = {
    ...originalEnv,
    CSRF_SECRET: 'test-csrf-secret',
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: 'https://snaprooms.app',
  }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest({ cookie = null, origin = 'https://snaprooms.app', csrfToken = null } = {}) {
  const headers = new Map()
  if (origin) headers.set('origin', origin)
  if (csrfToken) headers.set('x-csrf-token', csrfToken)

  return {
    cookies: {
      get: vi.fn((name) => (name === 'snaprooms_owner_session' && cookie ? { value: cookie } : undefined)),
    },
    headers: {
      get: (name) => headers.get(name),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue({})
  getStripe.mockReturnValue({
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session/test' }),
      },
    },
  })
})

describe('POST /api/stripe/customer-portal', () => {
  it('returns 401 when owner is not authenticated', async () => {
    verifyOwnerSessionToken.mockResolvedValue(null)

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Authentication required')
    expect(body.url).toBeUndefined()
  })

  it('returns 403 when origin is not allowed', async () => {
    verifyOwnerSessionToken.mockResolvedValue('owner@example.com')

    const response = await POST(createRequest({ cookie: 'session', origin: 'https://evil.com' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
    expect(body.url).toBeUndefined()
  })

  it('returns 403 when CSRF token is missing', async () => {
    verifyOwnerSessionToken.mockResolvedValue('owner@example.com')

    const response = await POST(createRequest({ cookie: 'session' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('csrf_missing')
    expect(body.url).toBeUndefined()
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const email = 'ratelimit@example.com'
    const token = createCsrfToken(email)
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-1',
      email,
      plan: 'professional',
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
    })

    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await POST(createRequest({ cookie: 'session', csrfToken: token }))
      expect(res.status).toBe(200)
    }

    const response = await POST(createRequest({ cookie: 'session', csrfToken: token }))
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.code).toBe('rate_limited')
    expect(body.url).toBeUndefined()
  })

  it('returns 404 when owner has no Stripe customer id', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-1',
      email,
      plan: 'professional',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })

    const response = await POST(
      createRequest({ cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Billing portal is not available for this account.')
    expect(body.stripeCustomerId).toBeUndefined()
  })

  it('returns 404 for free owner with a customer but no subscription', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-1',
      email,
      plan: 'free',
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: null,
    })

    const response = await POST(
      createRequest({ cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe('Billing portal is not available for this account.')
  })

  it('returns 200 with portal url for a Professional subscriber', async () => {
    const email = 'pro@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-2',
      email,
      plan: 'professional',
      stripeCustomerId: 'cus_pro',
      stripeSubscriptionId: 'sub_pro',
    })

    const response = await POST(
      createRequest({ cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://billing.stripe.com/session/test')
    expect(body.stripeCustomerId).toBeUndefined()
    expect(body.stripeSubscriptionId).toBeUndefined()

    const stripe = getStripe()
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_pro',
      return_url: expect.stringContaining('/dashboard?billing=portal_return'),
    })
  })

  it('returns 200 for a previously-subscribed owner who has a cancellation record', async () => {
    const email = 'cancelled@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-cancelled',
      email,
      plan: 'free',
      stripeCustomerId: 'cus_cancelled',
      stripeSubscriptionId: null,
      subscriptionCanceledAt: new Date(),
    })

    const response = await POST(
      createRequest({ cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://billing.stripe.com/session/test')
  })

  it('returns 500 with a safe message when Stripe throws', async () => {
    const email = 'pro@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({
      id: 'owner-3',
      email,
      plan: 'professional',
      stripeCustomerId: 'cus_pro',
      stripeSubscriptionId: 'sub_pro',
    })

    getStripe.mockReturnValue({
      billingPortal: {
        sessions: {
          create: vi.fn().mockRejectedValue(new Error('Stripe portal not configured')),
        },
      },
    })

    const response = await POST(
      createRequest({ cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Unable to open billing portal. Please try again later.')
    expect(body.url).toBeUndefined()
  })
})
