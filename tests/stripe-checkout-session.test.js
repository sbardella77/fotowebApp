import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createCsrfToken } from '@/lib/server/csrf'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/owner-auth', () => ({ verifyOwnerSessionToken: vi.fn() }))
vi.mock('@/lib/server/owner-resolution', () => ({ resolveCanonicalOwner: vi.fn() }))

import { POST } from '@/app/api/stripe/checkout-session/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'

const originalEnv = process.env

beforeAll(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    CSRF_SECRET: 'test-csrf-secret',
    ALLOWED_ORIGINS: 'https://snaprooms.app',
    NEXT_PUBLIC_BASE_URL: 'https://snaprooms.app',
    STRIPE_PRICE_ID_PRO_EVENT: 'price_pro_event_test',
    STRIPE_PRICE_ID_WEDDING_PRO: 'price_wedding_pro_test',
    STRIPE_PRICE_ID_EXTRA_EVENT: 'price_extra_event_test',
    STRIPE_PRICE_ID_PROFESSIONAL: 'price_professional_monthly_test',
    STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL: 'price_professional_annual_test',
  }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest({ body, cookie = 'session', origin = 'https://snaprooms.app', csrfToken = null } = {}) {
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
    json: vi.fn().mockResolvedValue(body || {}),
  }
}

const baseOwner = { id: 'owner-1', email: 'owner@example.com', plan: 'free', stripeCustomerId: 'cus_test' }

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue({
    event: { findFirst: vi.fn() },
    owner: { update: vi.fn().mockResolvedValue({ ...baseOwner }) },
    extraFreeEventCheckout: { create: vi.fn(), update: vi.fn() },
  })
  getStripe.mockReturnValue({
    customers: { create: vi.fn() },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' }),
      },
    },
  })
  resolveCanonicalOwner.mockResolvedValue({ ...baseOwner })
})

describe('POST /api/stripe/checkout-session', () => {
  it('returns 401 when owner is not authenticated', async () => {
    verifyOwnerSessionToken.mockResolvedValue(null)

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Authentication required')
  })

  it('returns 403 when origin is not allowed', async () => {
    verifyOwnerSessionToken.mockResolvedValue('owner@example.com')

    const response = await POST(createRequest({ origin: 'https://evil.com' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
  })

  it('returns 403 when CSRF token is missing', async () => {
    verifyOwnerSessionToken.mockResolvedValue('owner@example.com')

    const response = await POST(createRequest({ cookie: 'session' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('csrf_missing')
  })

  it('returns 400 for an invalid intent', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)

    const response = await POST(
      createRequest({ body: { intent: 'invalid' }, cookie: 'session', csrfToken: createCsrfToken(email) })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid or missing purchase intent')
  })

  it('returns 403 when event is not owned by the owner', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue(null)

    const response = await POST(
      createRequest({
        body: { intent: 'pro_event', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Event not found or not owned by you')
  })

  it('allows upgrading from pro_event to wedding_pro', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: 'pro_event' })

    const response = await POST(
      createRequest({
        body: { intent: 'wedding_pro', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://checkout.stripe.com/test')
  })

  it('blocks wedding_pro checkout when the event is already wedding_pro', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: 'wedding_pro' })

    const response = await POST(
      createRequest({
        body: { intent: 'wedding_pro', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('event_already_wedding_pro')
    expect(body.currentTier).toBe('wedding_pro')
  })

  it('blocks pro_event checkout when the event is already wedding_pro', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: 'wedding_pro' })

    const response = await POST(
      createRequest({
        body: { intent: 'pro_event', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('event_already_wedding_pro')
  })

  it('blocks event-level checkout for Professional/Business owners', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({ ...baseOwner, plan: 'professional', stripeSubscriptionId: 'sub_test' })
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: null })

    const response = await POST(
      createRequest({
        body: { intent: 'pro_event', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('Your account plan already includes unlimited photos for all events')
  })

  it('allows pro_event checkout for a free event', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: null })

    const response = await POST(
      createRequest({
        body: { intent: 'pro_event', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://checkout.stripe.com/test')
  })

  it('rejects eventId for extra_event purchases', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)

    const response = await POST(
      createRequest({
        body: { intent: 'extra_event', eventId: 'event-1' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('eventId must not be provided for extra_event purchases')
  })

  it('allows extra_event checkout without eventId', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)

    const response = await POST(
      createRequest({
        body: { intent: 'extra_event' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.url).toBe('https://checkout.stripe.com/test')
  })

  it('blocks duplicate Professional subscriptions', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    resolveCanonicalOwner.mockResolvedValue({ ...baseOwner, plan: 'professional', stripeSubscriptionId: 'sub_test' })

    const response = await POST(
      createRequest({
        body: { intent: 'professional' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('You already have an active Professional subscription')
  })

  it('returns 503 when the annual Professional price is not configured', async () => {
    const email = 'owner@example.com'
    verifyOwnerSessionToken.mockResolvedValue(email)
    const saved = process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL
    delete process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL

    const response = await POST(
      createRequest({
        body: { intent: 'professional', billingInterval: 'annual' },
        cookie: 'session',
        csrfToken: createCsrfToken(email),
      })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toContain('annual Professional plan is not available')

    process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL = saved
  })
})
