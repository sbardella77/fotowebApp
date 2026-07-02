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
vi.mock('@/lib/server/prisma-gallery-repository', () => ({
  prismaGalleryRepository: { createEvent: vi.fn() },
}))

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'

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
  const prisma = {
    event: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'event-1', slug: 'event-slug', ...data })),
    },
    owner: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'owner@example.com', extraEventCredits: 1 }),
      update: vi.fn().mockImplementation(({ data, where }) => {
        const credits = typeof data.extraEventCredits?.increment === 'number' ? 1 + data.extraEventCredits.increment : 1
        return Promise.resolve({ id: where?.id || 'owner-1', email: 'owner@example.com', extraEventCredits: credits })
      }),
    },
    extraFreeEventCheckout: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'pending-1' }),
      update: vi.fn().mockImplementation(({ data, where }) => Promise.resolve({ id: where?.id || 'pending-1', ...data })),
    },
    upsellEvent: { create: vi.fn().mockResolvedValue({ id: 'upsell-1' }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
  prisma.$transaction = vi.fn(async (fn) => fn(prisma))
  return prisma
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

  describe('Extra Free Event credit-only', () => {
    it('grants exactly one credit and marks pending checkout as credit_granted', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_credit',
        extra: { postPurchaseAction: 'credit_only', pendingCheckoutId: 'pending-credit-1' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue({
        id: 'pending-credit-1',
        ownerId: 'owner-1',
        eventName: null,
        status: 'checkout_created',
      })

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(body.received).toBe(true)
      expect(prisma.owner.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'owner-1' },
          data: expect.objectContaining({ extraEventCredits: { increment: 1 } }),
        })
      )
      expect(prisma.extraFreeEventCheckout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-credit-1' },
          data: expect.objectContaining({ status: 'credit_granted' }),
        })
      )
    })

    it('skips credit grant when pending checkout is already credit_granted', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_credit',
        extra: { postPurchaseAction: 'credit_only', pendingCheckoutId: 'pending-credit-1' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue({
        id: 'pending-credit-1',
        ownerId: 'owner-1',
        eventName: null,
        status: 'credit_granted',
      })

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(body.received).toBe(true)
      expect(prisma.owner.update).not.toHaveBeenCalled()
      expect(prisma.extraFreeEventCheckout.update).not.toHaveBeenCalled()
    })

    it('grants only one credit when the same session is delivered twice', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_credit_twice',
        extra: { postPurchaseAction: 'credit_only', pendingCheckoutId: 'pending-credit-2' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()

      // First delivery: pending row exists in checkout_created state.
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue({
        id: 'pending-credit-2',
        ownerId: 'owner-1',
        eventName: null,
        status: 'checkout_created',
      })
      const first = await POST(createWebhookRequest())
      expect((await first.json()).received).toBe(true)
      expect(prisma.owner.update).toHaveBeenCalledTimes(1)

      // Simulate the row now being credit_granted for the second delivery.
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue({
        id: 'pending-credit-2',
        ownerId: 'owner-1',
        eventName: null,
        status: 'credit_granted',
      })
      vi.clearAllMocks()
      const second = await POST(createWebhookRequest())
      expect((await second.json()).received).toBe(true)
      expect(prisma.owner.update).not.toHaveBeenCalled()
    })
  })

  describe('Extra Free Event buy-and-create', () => {
    it('skips auto-create when the pending checkout is already auto_created', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_create',
        extra: { postPurchaseAction: 'create_event', pendingCheckoutId: 'pending-1' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()
      const pending = {
        id: 'pending-1',
        ownerId: 'owner-1',
        eventName: 'Birthday Party',
        status: 'auto_created',
      }
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue(pending)
      prisma.extraFreeEventCheckout.findFirst.mockResolvedValue(pending)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(body.received).toBe(true)
      expect(prisma.extraFreeEventCheckout.update).not.toHaveBeenCalled()
      expect(prisma.owner.update).not.toHaveBeenCalled()
    })

    it('grants exactly one fallback credit and marks pending checkout as failed when auto-create fails', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_create_fail',
        extra: { postPurchaseAction: 'create_event', pendingCheckoutId: 'pending-fail-1' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()
      const pending = {
        id: 'pending-fail-1',
        ownerId: 'owner-1',
        eventName: 'Birthday Party',
        status: 'checkout_created',
      }
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue(pending)
      prisma.extraFreeEventCheckout.findFirst.mockResolvedValue(pending)
      prismaGalleryRepository.createEvent.mockRejectedValue(new Error('create failed'))

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(body.received).toBe(true)
      expect(prisma.owner.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'owner-1' },
          data: expect.objectContaining({ extraEventCredits: { increment: 1 } }),
        })
      )
      expect(prisma.extraFreeEventCheckout.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pending-fail-1' },
          data: expect.objectContaining({ status: 'failed' }),
        })
      )
    })

    it('does not grant a second fallback credit when retry hits a failed pending checkout', async () => {
      const session = buildCheckoutSession({
        intent: 'extra_event',
        sessionId: 'cs_create_fail',
        extra: { postPurchaseAction: 'create_event', pendingCheckoutId: 'pending-fail-1' },
      })
      getStripe.mockReturnValue({
        webhooks: {
          constructEvent: vi.fn(() => buildStripeEvent('checkout.session.completed', session)),
        },
      })
      const prisma = await getPrismaClient()
      const pending = {
        id: 'pending-fail-1',
        ownerId: 'owner-1',
        eventName: 'Birthday Party',
        status: 'failed',
      }
      prisma.extraFreeEventCheckout.findUnique.mockResolvedValue(pending)
      prisma.extraFreeEventCheckout.findFirst.mockResolvedValue(pending)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(body.received).toBe(true)
      expect(prisma.owner.update).not.toHaveBeenCalled()
      expect(prisma.extraFreeEventCheckout.update).not.toHaveBeenCalled()
    })
  })
})
