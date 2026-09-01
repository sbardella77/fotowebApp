import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createCsrfToken } from '@/lib/server/csrf'

// Regression contract for the Professional checkout rate-limit fix: Monthly
// and Annual used to share one `checkout:professional:owner:<hash>` bucket
// (5 requests / 10 min combined), so a user legitimately comparing/retrying
// billing intervals could exhaust it and get 429'd on a plan they'd never
// actually tried — confirmed live in Production logs. The fix scopes the
// key by billingInterval for the `professional` intent only; every other
// intent's key format is asserted unchanged here too.

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/owner-auth', () => ({ verifyOwnerSessionToken: vi.fn() }))
vi.mock('@/lib/server/owner-resolution', () => ({ resolveCanonicalOwner: vi.fn() }))
vi.mock('@/lib/server/rate-limiter', async () => {
  const actual = await vi.importActual('@/lib/server/rate-limiter')
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  }
})

import { POST } from '@/app/api/stripe/checkout-session/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'
import { checkRateLimit, hashIdentifier } from '@/lib/server/rate-limiter'

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

const EMAIL = 'owner@example.com'
const baseOwner = { id: 'owner-1', email: EMAIL, plan: 'free', stripeCustomerId: 'cus_test' }

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

beforeEach(() => {
  vi.clearAllMocks()
  checkRateLimit.mockResolvedValue({ limited: false })
  getPrismaClient.mockResolvedValue({
    event: { findFirst: vi.fn() },
    owner: { update: vi.fn().mockResolvedValue({ ...baseOwner }) },
    extraFreeEventCheckout: { create: vi.fn().mockResolvedValue({ id: 'pending-1' }), update: vi.fn() },
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
  verifyOwnerSessionToken.mockResolvedValue(EMAIL)
})

async function postCheckout(body) {
  return POST(createRequest({ body, csrfToken: createCsrfToken(EMAIL) }))
}

function keysUsedFor(intentLabel) {
  return checkRateLimit.mock.calls
    .map(([key]) => key)
    .filter((key) => key.startsWith(`checkout:${intentLabel}`))
}

describe('Professional checkout rate-limit key isolation by billing interval', () => {
  it('Professional Monthly produces a monthly-specific bucket/key', async () => {
    const response = await postCheckout({ intent: 'professional', billingInterval: 'monthly' })
    expect(response.status).toBe(200)
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.some((k) => k.includes('professional:monthly'))).toBe(true)
    expect(keys.some((k) => k.includes('professional:annual'))).toBe(false)
  })

  it('Professional Annual produces an annual-specific bucket/key', async () => {
    const response = await postCheckout({ intent: 'professional', billingInterval: 'annual' })
    expect(response.status).toBe(200)
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.some((k) => k.includes('professional:annual'))).toBe(true)
    expect(keys.some((k) => k.includes('professional:monthly'))).toBe(false)
  })

  it('Monthly and Annual owner keys are distinct for the same owner (no shared bucket)', async () => {
    await postCheckout({ intent: 'professional', billingInterval: 'monthly' })
    const monthlyOwnerKey = checkRateLimit.mock.calls.find(([k]) => k.includes(':owner:'))[0]

    checkRateLimit.mockClear()
    await postCheckout({ intent: 'professional', billingInterval: 'annual' })
    const annualOwnerKey = checkRateLimit.mock.calls.find(([k]) => k.includes(':owner:'))[0]

    expect(monthlyOwnerKey).not.toBe(annualOwnerKey)
  })

  it('the owner-key hash itself is identical between Monthly and Annual (only the scope segment differs)', async () => {
    const expectedHash = hashIdentifier(EMAIL)
    expect(expectedHash).toBeTruthy()

    await postCheckout({ intent: 'professional', billingInterval: 'monthly' })
    const monthlyKey = keysUsedFor('professional')[0]
    checkRateLimit.mockClear()
    await postCheckout({ intent: 'professional', billingInterval: 'annual' })
    const annualKey = keysUsedFor('professional')[0]

    expect(monthlyKey).toBe(`checkout:professional:monthly:owner:${expectedHash}`)
    expect(annualKey).toBe(`checkout:professional:annual:owner:${expectedHash}`)
  })

  it('omitting billingInterval defaults to the monthly bucket (matches price-selection default)', async () => {
    await postCheckout({ intent: 'professional' })
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys.some((k) => k.includes('professional:monthly'))).toBe(true)
  })
})

describe('Unrelated checkout intents keep their original, unscoped rate-limit keys', () => {
  it('pro_event key is unchanged (no billingInterval segment)', async () => {
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: null })
    const expectedHash = hashIdentifier(EMAIL)

    await postCheckout({ intent: 'pro_event', eventId: 'event-1' })
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys).toContain(`checkout:pro_event:owner:${expectedHash}`)
  })

  it('wedding_pro key is unchanged (no billingInterval segment)', async () => {
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: null })
    const expectedHash = hashIdentifier(EMAIL)

    await postCheckout({ intent: 'wedding_pro', eventId: 'event-1' })
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys).toContain(`checkout:wedding_pro:owner:${expectedHash}`)
  })

  it('extra_event key is unchanged (no billingInterval segment)', async () => {
    const expectedHash = hashIdentifier(EMAIL)

    await postCheckout({ intent: 'extra_event' })
    const keys = checkRateLimit.mock.calls.map(([key]) => key)
    expect(keys).toContain(`checkout:extra_event:owner:${expectedHash}`)
  })
})
