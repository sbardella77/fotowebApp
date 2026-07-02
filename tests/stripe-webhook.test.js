import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/billing-emails', () => ({
  sendProEventPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendWeddingProPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreditGrantedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreatedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventFallbackCreditEmail: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'

const originalEnv = process.env

beforeAll(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  }
})

afterAll(() => {
  process.env = originalEnv
})

function createWebhookRequest({ payload = '{}', signature = 'sig_test' } = {}) {
  return {
    text: vi.fn().mockResolvedValue(payload),
    headers: {
      get: vi.fn((name) => (name === 'stripe-signature' ? signature : null)),
    },
  }
}

function buildStripeEvent(type, object) {
  return { type, data: { object } }
}

function buildCheckoutSession({ intent, eventId, sessionId = 'cs_test', extra = {} }) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'owner@example.com',
    metadata: {
      intent,
      ownerId: 'owner-1',
      ownerEmail: 'owner@example.com',
      eventId: eventId || '',
      roomSlug: 'event-slug',
      ...extra,
    },
    ...extra,
  }
}

function createPrismaMock(overrides = {}) {
  return {
    event: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'event-1', slug: 'event-slug', ...data })),
    },
    owner: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'owner@example.com', extraEventCredits: 1 }),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'owner-1', email: 'owner@example.com', ...data })),
    },
    extraFreeEventCheckout: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'pending-1' }),
      update: vi.fn().mockResolvedValue({ id: 'pending-1', status: 'auto_created' }),
    },
    upsellEvent: { create: vi.fn().mockResolvedValue({ id: 'upsell-1' }) },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(createPrismaMock())
  getStripe.mockReturnValue({
    webhooks: {
      constructEvent: vi.fn((_payload, _signature, _secret) => buildStripeEvent('checkout.session.completed', {})),
    },
  })
})

describe('POST /api/stripe/webhook', () => {
  it('fulfills a wedding_pro upgrade from pro_event', async () => {
    const session = buildCheckoutSession({ intent: 'wedding_pro', eventId: 'event-1' })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.event.findUnique.mockResolvedValue({ billingTier: 'pro_event' })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({ billingTier: 'wedding_pro' }),
      })
    )
  })

  it('skips event upgrade when the same checkout session was already fulfilled', async () => {
    const session = buildCheckoutSession({ intent: 'wedding_pro', eventId: 'event-1', sessionId: 'cs_fulfilled' })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.event.findFirst.mockResolvedValue({ id: 'event-1', slug: 'event-slug', billingTier: 'wedding_pro', stripeCheckoutSessionId: 'cs_fulfilled' })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('skips pro_event fulfillment when the event is already wedding_pro', async () => {
    const session = buildCheckoutSession({ intent: 'pro_event', eventId: 'event-1' })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.event.findUnique.mockResolvedValue({ billingTier: 'wedding_pro' })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('skips event upgrade when the event already has the requested billing tier', async () => {
    const session = buildCheckoutSession({ intent: 'pro_event', eventId: 'event-1' })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.event.findUnique.mockResolvedValue({ billingTier: 'pro_event' })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('skips legacy extra_event credit when the same session was already granted', async () => {
    const session = buildCheckoutSession({ intent: 'extra_event', eventId: '', sessionId: 'cs_credit' })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'owner@example.com', extraEventCheckoutSessionId: 'cs_credit' })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.owner.update).not.toHaveBeenCalled()
  })

  it('skips buy-and-create when the pending checkout is already auto_created', async () => {
    const session = buildCheckoutSession({
      intent: 'extra_event',
      eventId: '',
      sessionId: 'cs_create',
      extra: { pendingCheckoutId: 'pending-1', postPurchaseAction: 'create_event' },
    })
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
      },
    })
    const prisma = await getPrismaClient()
    prisma.extraFreeEventCheckout.findFirst.mockResolvedValue({
      id: 'pending-1',
      ownerId: 'owner-1',
      status: 'auto_created',
    })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(body.received).toBe(true)
    expect(prisma.extraFreeEventCheckout.update).not.toHaveBeenCalled()
  })
})
