import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/stripe', () => ({ getStripe: vi.fn() }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))
vi.mock('@/lib/analytics/track-server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/server/billing-emails', () => ({
  sendProEventPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendWeddingProPurchasedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreditGrantedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreatedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventFallbackCreditEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalActivatedEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalPaymentRecoveredEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalCanceledEmail: vi.fn().mockResolvedValue(undefined),
  sendProfessionalCancellationScheduledEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/prisma-gallery-repository', () => ({
  prismaGalleryRepository: { createEvent: vi.fn() },
}))
// The receipt state machine itself is exhaustively tested in
// tests/stripe-webhook-receipt.test.js. Here we mock its three entry points
// so each scenario can drive the wrapper's contract (2xx -> PROCESSED,
// non-2xx/throw -> FAILED, ALREADY_PROCESSED/IN_PROGRESS short-circuit)
// directly, without needing to reconstruct DB-level claim/lease state.
vi.mock('@/lib/server/stripe-webhook-receipt', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    claimStripeWebhookEvent: vi.fn(),
    markStripeWebhookEventProcessed: vi.fn(),
    markStripeWebhookEventFailed: vi.fn(),
  }
})

import { POST } from '@/app/api/stripe/webhook/route'
import { processClaimedStripeWebhookEvent } from '@/lib/server/stripe-webhook-wrapper'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
  StripeWebhookClaimAction,
  StripeWebhookFencingError,
} from '@/lib/server/stripe-webhook-receipt'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' }
})

afterAll(() => {
  process.env = originalEnv
})

function createWebhookRequest({ payload = '{}', signature = 'sig_test' } = {}) {
  return {
    text: vi.fn().mockResolvedValue(payload),
    headers: { get: vi.fn((name) => (name === 'stripe-signature' ? signature : null)) },
  }
}

let webhookEventIdSeq = 0
function buildStripeEvent(type, object, id) {
  webhookEventIdSeq += 1
  return { id: id || `evt_wiring_${webhookEventIdSeq}`, type, data: { object } }
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

function createBusinessPrismaMock(overrides = {}) {
  const prisma = {
    event: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'event-1', slug: 'event-slug', ...data })),
    },
    owner: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: 'owner@example.com', extraEventCredits: 1 }),
      update: vi.fn().mockImplementation(({ data, where }) => Promise.resolve({ id: where?.id || 'owner-1', email: 'owner@example.com', ...data })),
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

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(createBusinessPrismaMock())
})

describe('Stripe webhook claim/receipt wiring', () => {
  it('A: invalid signature returns 400 and never calls claim', async () => {
    getStripe.mockReturnValue({
      webhooks: { constructEvent: vi.fn(() => { throw new Error('bad signature') }) },
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(400)
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('B: Prisma unavailable returns 503 and never calls claim', async () => {
    getPrismaClient.mockResolvedValue(null)
    mockConstructEvent(buildStripeEvent('checkout.session.completed', {}))

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(503)
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('C: unsupported event type returns 200 and never calls claim', async () => {
    mockConstructEvent(buildStripeEvent('payment_intent.succeeded', {}))

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('C-regression: unsupported event returns 200 even when Prisma is unavailable, and never touches the DB/receipt pipeline', async () => {
    // Signature verification must still succeed — only Prisma is unavailable.
    getPrismaClient.mockResolvedValue(null)
    mockConstructEvent(buildStripeEvent('payment_intent.succeeded', {}))

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(getPrismaClient).not.toHaveBeenCalled()
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: a first handled event runs business logic, marks processed with the claimed attempt, returns 200', async () => {
    const stripeEvent = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1700000000,
    })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com', subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(claimStripeWebhookEvent).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, eventType: 'customer.subscription.updated' })
    expect(prisma.owner.update).toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
  })

  it('E: ALREADY_PROCESSED returns 200 without running business logic', async () => {
    mockConstructEvent(buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }))
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.ALREADY_PROCESSED, receipt: {} })

    const prisma = await getPrismaClient()
    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.owner.findFirst).not.toHaveBeenCalled()
    expect(prisma.owner.update).not.toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('F: IN_PROGRESS returns 503 with Retry-After, without running business logic', async () => {
    mockConstructEvent(buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }))
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.IN_PROGRESS, receipt: {} })

    const prisma = await getPrismaClient()
    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ received: false, code: 'webhook_processing_in_progress' })
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(prisma.owner.findFirst).not.toHaveBeenCalled()
  })

  it('G: a business handler returning 500 marks the receipt FAILED and keeps the response non-2xx', async () => {
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventFailed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
    prisma.owner.update.mockRejectedValue(new Error('write failed'))
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)
    expect(markStripeWebhookEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({ prisma, eventId: stripeEvent.id, attempt: 1, error: expect.any(Error) })
    )
  })

  it('H: markFailed itself failing still returns the original non-2xx and logs a separate alert', async () => {
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventFailed.mockRejectedValue(new Error('finalize failed'))

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
    prisma.owner.update.mockRejectedValue(new Error('write failed'))
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)
    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stripe:webhook:finalize_failed_failed' })
    )
  })

  it('I: markProcessed generic failure never returns the original 2xx', async () => {
    // Uses invoice.payment_succeeded (still on the legacy, non-atomic
    // contract as of STEP 4.3) specifically to exercise the wrapper's own
    // external markProcessed-failure branch — subscription.updated/deleted
    // no longer call markProcessed externally, so they can't drive this path.
    const stripeEvent = buildStripeEvent('invoice.payment_succeeded', { id: 'in_1', subscription: 'sub_1', customer: 'cus_1', status: 'paid' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockRejectedValue(new Error('db blip'))

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_receipt_finalization_failed')
  })

  it('J: a StripeWebhookFencingError on markProcessed returns 503 without alerting or touching markFailed', async () => {
    // STEP 4.2: fencing loss is expected system behavior (another worker
    // already reclaimed), not an infrastructure failure — unlike the
    // generic-error branch (test I), it no longer pages ops, and it must
    // never fall back to markFailed with the now-stale attempt token.
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockRejectedValue(new StripeWebhookFencingError('lost the claim'))

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')
    expect(sendOpsAlert).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('K: a legitimate skip (owner not found) still marks the receipt processed and returns 200', async () => {
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_missing', status: 'active' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue(null)
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(prisma.owner.update).not.toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
  })

  it('L: a concurrent duplicate delivery runs business logic exactly once', async () => {
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' })
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent
      .mockResolvedValueOnce({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
      .mockResolvedValueOnce({ action: StripeWebhookClaimAction.IN_PROGRESS, receipt: {} })
    markStripeWebhookEventProcessed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
    getPrismaClient.mockResolvedValue(prisma)

    const [first, second] = await Promise.all([POST(createWebhookRequest()), POST(createWebhookRequest())])

    expect(prisma.owner.update).toHaveBeenCalledTimes(1)
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 503])
  })

  it('M: a duplicate delivery after PROCESSED produces no duplicated side effects', async () => {
    mockConstructEvent(buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }))
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.ALREADY_PROCESSED, receipt: {} })

    const prisma = await getPrismaClient()
    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(prisma.owner.update).not.toHaveBeenCalled()
    expect(sendOpsAlert).not.toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('N: a successful extra_event buy-and-create compensation marks PROCESSED, not FAILED', async () => {
    const session = buildCheckoutSession({
      intent: 'extra_event',
      sessionId: 'cs_create_fail',
      extra: { postPurchaseAction: 'create_event', pendingCheckoutId: 'pending-fail-1' },
    })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    const pending = { id: 'pending-fail-1', ownerId: 'owner-1', eventName: 'Birthday Party', status: 'checkout_created' }
    prisma.extraFreeEventCheckout.findUnique.mockResolvedValue(pending)
    prisma.extraFreeEventCheckout.findFirst.mockResolvedValue(pending)
    prismaGalleryRepository.createEvent.mockRejectedValue(new Error('create failed'))
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.extraFreeEventCheckout.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    )
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  describe('O: the four former success-fallthrough branches now return explicitly and finalize', () => {
    it('pro_event/wedding_pro success', async () => {
      const session = buildCheckoutSession({ intent: 'wedding_pro', eventId: 'event-1' })
      const stripeEvent = buildStripeEvent('checkout.session.completed', session)
      mockConstructEvent(stripeEvent)
      claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
      markStripeWebhookEventProcessed.mockResolvedValue({})

      const prisma = createBusinessPrismaMock()
      prisma.event.findUnique.mockResolvedValue({ billingTier: 'pro_event' })
      getPrismaClient.mockResolvedValue(prisma)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(prisma.event.update).toHaveBeenCalled()
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    })

    it('professional success', async () => {
      const session = buildCheckoutSession({ intent: 'professional' })
      const stripeEvent = buildStripeEvent('checkout.session.completed', session)
      mockConstructEvent(stripeEvent)
      claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
      markStripeWebhookEventProcessed.mockResolvedValue({})

      const prisma = createBusinessPrismaMock()
      getPrismaClient.mockResolvedValue(prisma)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(prisma.owner.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plan: 'professional' }) })
      )
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    })

    it('customer.subscription.updated success', async () => {
      const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' })
      mockConstructEvent(stripeEvent)
      claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
      markStripeWebhookEventProcessed.mockResolvedValue({})

      const prisma = createBusinessPrismaMock()
      prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com' })
      getPrismaClient.mockResolvedValue(prisma)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(prisma.owner.update).toHaveBeenCalled()
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    })

    it('customer.subscription.deleted success', async () => {
      const stripeEvent = buildStripeEvent('customer.subscription.deleted', { id: 'sub_1' })
      mockConstructEvent(stripeEvent)
      claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
      markStripeWebhookEventProcessed.mockResolvedValue({})

      const prisma = createBusinessPrismaMock()
      prisma.owner.findFirst.mockResolvedValue({ id: 'owner-1', email: 'o@example.com', subscriptionStatus: 'active', subscriptionCancelAtPeriodEnd: false })
      getPrismaClient.mockResolvedValue(prisma)

      const response = await POST(createWebhookRequest())
      const body = await response.json()

      expect(prisma.owner.update).toHaveBeenCalled()
      expect(response.status).toBe(200)
      expect(body.received).toBe(true)
      expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: stripeEvent.id, attempt: 1 })
    })
  })

  it('P: an unknown checkout intent keeps its ops alert, marks processed, and returns 200', async () => {
    const session = buildCheckoutSession({ intent: 'mystery_intent' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventProcessed.mockResolvedValue({})

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(sendOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'billing:webhook:unknown_intent' })
    )
    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('Q: an uncaught throw inside the business handler marks FAILED and returns a non-2xx', async () => {
    const session = buildCheckoutSession({
      intent: 'extra_event',
      sessionId: 'cs_create_throw',
      extra: { postPurchaseAction: 'create_event', pendingCheckoutId: 'pending-throw-1' },
    })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: StripeWebhookClaimAction.PROCESS, receipt: { attempts: 1 } })
    markStripeWebhookEventFailed.mockResolvedValue({})

    const prisma = createBusinessPrismaMock()
    const pending = { id: 'pending-throw-1', ownerId: 'owner-1', eventName: 'Birthday Party', status: 'checkout_created' }
    prisma.extraFreeEventCheckout.findUnique.mockResolvedValue(pending)
    prisma.extraFreeEventCheckout.findFirst.mockResolvedValue(pending)
    // This owner lookup sits outside any try/catch in fulfillExtraFreeEventBuyAndCreate —
    // an unexpected rejection here is exactly the "uncaught throw" case.
    prisma.owner.findUnique.mockRejectedValue(new Error('connection reset'))
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)
    expect(markStripeWebhookEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({ prisma, eventId: stripeEvent.id, attempt: 1, error: expect.any(Error) })
    )
  })
})

// STEP 4.2: the RECEIPT_ALREADY_FINALIZED tagged-outcome contract. No real
// handler produces this yet — these tests drive processClaimedStripeWebhookEvent
// directly with synthetic `run()` functions, which is the only way to exercise
// the new branch without migrating a handler (explicitly out of scope here).
describe('processClaimedStripeWebhookEvent: RECEIPT_ALREADY_FINALIZED tagged outcome (STEP 4.2)', () => {
  it('A: a legacy 2xx response still finalizes via markProcessed exactly once', async () => {
    const prisma = createBusinessPrismaMock()
    markStripeWebhookEventProcessed.mockResolvedValue({})
    const legacyResponse = NextResponse.json({ received: true })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_a',
      attempt: 1,
      run: async () => legacyResponse,
    })

    expect(result).toBe(legacyResponse)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith({ prisma, eventId: 'evt_a', attempt: 1 })
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('B: a legacy non-2xx response calls markFailed', async () => {
    const prisma = createBusinessPrismaMock()
    markStripeWebhookEventFailed.mockResolvedValue({})
    const legacyResponse = NextResponse.json({ error: 'boom' }, { status: 500 })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_b',
      attempt: 1,
      run: async () => legacyResponse,
    })

    expect(result.status).toBe(500)
    expect(markStripeWebhookEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({ prisma, eventId: 'evt_b', attempt: 1 })
    )
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('C: a valid RECEIPT_ALREADY_FINALIZED 200 outcome is returned as-is, no further finalization', async () => {
    const prisma = createBusinessPrismaMock()
    const atomicResponse = NextResponse.json({ received: true })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_c',
      attempt: 1,
      run: async () => ({ kind: 'RECEIPT_ALREADY_FINALIZED', response: atomicResponse }),
    })

    expect(result).toBe(atomicResponse)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: a valid RECEIPT_ALREADY_FINALIZED 204 outcome is allowed, no further finalization', async () => {
    const prisma = createBusinessPrismaMock()
    const atomicResponse = new NextResponse(null, { status: 204 })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_d',
      attempt: 1,
      run: async () => ({ kind: 'RECEIPT_ALREADY_FINALIZED', response: atomicResponse }),
    })

    expect(result).toBe(atomicResponse)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('E: a RECEIPT_ALREADY_FINALIZED outcome with a non-2xx response is an invariant failure, not atomic success', async () => {
    const prisma = createBusinessPrismaMock()
    const badResponse = NextResponse.json({ error: 'should never happen' }, { status: 500 })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_e',
      attempt: 1,
      run: async () => ({ kind: 'RECEIPT_ALREADY_FINALIZED', response: badResponse }),
    })

    expect(result.status).toBe(500)
    expect(result).not.toBe(badResponse)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('F: a RECEIPT_ALREADY_FINALIZED outcome with no response attached is an invariant failure', async () => {
    const prisma = createBusinessPrismaMock()

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_f',
      attempt: 1,
      run: async () => ({ kind: 'RECEIPT_ALREADY_FINALIZED' }),
    })

    expect(result.status).toBe(500)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('G: a RECEIPT_ALREADY_FINALIZED outcome with a malformed response is an invariant failure', async () => {
    const prisma = createBusinessPrismaMock()

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_g',
      attempt: 1,
      run: async () => ({ kind: 'RECEIPT_ALREADY_FINALIZED', response: { received: true } }),
    })

    expect(result.status).toBe(500)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('H: a non-tagged, non-Response object returned by mistake is an invariant failure, never an accidental success', async () => {
    const prisma = createBusinessPrismaMock()

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_h',
      attempt: 1,
      run: async () => ({ received: true }),
    })

    expect(result.status).toBe(500)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('I: a handler throwing StripeWebhookFencingError returns 503 without calling markFailed', async () => {
    const prisma = createBusinessPrismaMock()

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_i',
      attempt: 1,
      run: async () => { throw new StripeWebhookFencingError('lost the claim mid-transaction') },
    })

    expect(result.status).toBe(503)
    const body = await result.json()
    expect(body.code).toBe('webhook_processing_in_progress')
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('J: a handler throwing a generic error calls markFailed and returns 500', async () => {
    const prisma = createBusinessPrismaMock()
    markStripeWebhookEventFailed.mockResolvedValue({})

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_j',
      attempt: 1,
      run: async () => { throw new Error('unexpected') },
    })

    expect(result.status).toBe(500)
    expect(markStripeWebhookEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({ prisma, eventId: 'evt_j', attempt: 1, error: expect.any(Error) })
    )
  })

  it('K: markProcessed itself throwing StripeWebhookFencingError returns 503 without calling markFailed', async () => {
    const prisma = createBusinessPrismaMock()
    markStripeWebhookEventProcessed.mockRejectedValue(new StripeWebhookFencingError('lost the claim'))
    const legacyResponse = NextResponse.json({ received: true })

    const result = await processClaimedStripeWebhookEvent({
      prisma,
      eventId: 'evt_k',
      attempt: 1,
      run: async () => legacyResponse,
    })

    expect(result.status).toBe(503)
    const body = await result.json()
    expect(body.code).toBe('webhook_processing_in_progress')
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })
})
