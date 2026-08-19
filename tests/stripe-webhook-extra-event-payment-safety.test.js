import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// STEP: billing PR 1 — checkout.session.completed's payment_status gate,
// the new checkout.session.async_payment_succeeded / async_payment_failed /
// expired handlers, and the full extra_event state machine end to end
// through POST /api/stripe/webhook. Complements tests/extra-free-event-
// fulfillment.test.js (direct unit tests of the shared module) with
// route-level dispatch/HANDLED_STRIPE_EVENT_TYPES/receipt-finalization
// coverage.

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
vi.mock('@/lib/server/stripe-webhook-receipt', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    claimStripeWebhookEvent: vi.fn(),
    markStripeWebhookEventProcessed: vi.fn(actual.markStripeWebhookEventProcessed),
    markStripeWebhookEventFailed: vi.fn(actual.markStripeWebhookEventFailed),
  }
})

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  sendExtraFreeEventCreditGrantedEmail,
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
} from '@/lib/server/billing-emails'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
} from '@/lib/server/stripe-webhook-receipt'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'

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

let eventIdSeq = 0
function buildStripeEvent(type, object, id) {
  eventIdSeq += 1
  return { id: id || `evt_pay_safety_${eventIdSeq}`, type, data: { object } }
}

function buildSession({
  sessionId = 'cs_pay_safety',
  ownerId = 'owner-1',
  postPurchaseAction = 'credit_only',
  paymentStatus = 'paid',
} = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'owner@example.com',
    payment_status: paymentStatus,
    metadata: {
      intent: 'extra_event',
      ownerId,
      ownerEmail: 'owner@example.com',
      postPurchaseAction,
      upsellType: 'extra_event',
      upsellSource: 'dashboard',
      productType: 'extra_free_event',
    },
  }
}

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

function seedReceipt({ eventId, status, attempts, eventType = 'checkout.session.completed' }) {
  return { id: `swe-seed-${eventId}`, eventId, eventType, status, attempts, lastError: null, receivedAt: new Date(), processingStartedAt: new Date(), processedAt: null, updatedAt: new Date() }
}

function seedOwner({ id = 'owner-1', extraEventCredits = 0 } = {}) {
  return { id, email: 'owner@example.com', extraEventCredits, extraEventCheckoutSessionId: null }
}

function seedCheckout({ id = 'checkout-1', sessionId, ownerId = 'owner-1', eventName = 'Birthday Party', status = 'checkout_created' } = {}) {
  return { id, ownerId, stripeCheckoutSessionId: sessionId, eventName, status, createdEventId: null, createdEventSlug: null, errorMessage: null, completedAt: null, autoCreatedAt: null }
}

function dispatch({ type, session, receiptStatus = 'PROCESSING', attempts = 1, seed = {} }) {
  const stripeEventId = `evt_${type.replace(/\./g, '_')}_${eventIdSeq + 1}`
  const stripeEvent = buildStripeEvent(type, session, stripeEventId)
  mockConstructEvent(stripeEvent)
  claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts } })

  const prisma = createFakeTransactionalPrisma({
    owner: [seedOwner()],
    event: [],
    extraFreeEventCheckout: [seedCheckout({ sessionId: session.id, ...seed.checkoutOverrides })],
    stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: receiptStatus, attempts, eventType: type })],
    ...seed.tables,
  })
  getPrismaClient.mockResolvedValue(prisma)
  return { prisma, stripeEventId }
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaGalleryRepository.createEvent.mockImplementation(async ({ name, prismaClient }) =>
    prismaClient.event.create({ data: { id: 'event-1', slug: 'birthday-party', name } }),
  )
})

describe('checkout.session.completed — payment-safety gate', () => {
  it('merge-blocking: payment_status=unpaid defers fulfillment — checkout stays checkout_created, receipt still PROCESSED, 200', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const { prisma, stripeEventId } = dispatch({ type: 'checkout.session.completed', session })

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(sendExtraFreeEventCreditGrantedEmail).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('payment_status=paid fulfills normally (sanity regression for the gate itself)', async () => {
    const session = buildSession({ paymentStatus: 'paid' })
    const { prisma } = dispatch({ type: 'checkout.session.completed', session })

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
  })
})

describe('checkout.session.async_payment_succeeded', () => {
  it('paid: fulfills via the same shared logic as completed+paid', async () => {
    const session = buildSession({ paymentStatus: 'paid' })
    const { prisma } = dispatch({ type: 'checkout.session.async_payment_succeeded', session })

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
  })

  it('without payment_status=paid: no-op, checkout unchanged', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const { prisma } = dispatch({ type: 'checkout.session.async_payment_succeeded', session })

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')
  })

  it('merge-blocking (state machine): completed(unpaid) then async_payment_succeeded(paid) grants exactly one entitlement — no double grant', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const sessionId = session.id

    // Shared prisma instance across all deliveries — same underlying row.
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId })],
      stripeWebhookEvent: [],
    })
    getPrismaClient.mockResolvedValue(prisma)

    // Delivery 1: completed, still unpaid. Each delivery gets its own
    // Stripe event id and its own seeded receipt row (claimStripeWebhookEvent
    // is mocked, but the REAL markStripeWebhookEventProcessed still needs a
    // matching PROCESSING row to update).
    const completedEvent = buildStripeEvent('checkout.session.completed', session, 'evt_sm_completed')
    mockConstructEvent(completedEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_sm_completed', status: 'PROCESSING', attempts: 1 }))
    const r1 = await POST(createWebhookRequest())
    expect(r1.status).toBe(200)
    expect((await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })).status).toBe('checkout_created')

    // Delivery 2: async_payment_succeeded, now paid.
    const paidSession = { ...session, payment_status: 'paid' }
    const asyncEvent = buildStripeEvent('checkout.session.async_payment_succeeded', paidSession, 'evt_sm_async_succeeded')
    mockConstructEvent(asyncEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_sm_async_succeeded', status: 'PROCESSING', attempts: 1 }))
    const r2 = await POST(createWebhookRequest())
    expect(r2.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    // A redundant THIRD delivery of the SAME async_payment_succeeded Stripe
    // event id short-circuits at the receipt layer — never re-runs the
    // handler at all, so it cannot grant a second credit.
    mockConstructEvent(asyncEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'ALREADY_PROCESSED', receipt: { attempts: 1 } })
    const r3 = await POST(createWebhookRequest())
    expect(r3.status).toBe(200)
    const ownerAfterRetry = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(ownerAfterRetry.extraEventCredits).toBe(1)
  })
})

describe('checkout.session.async_payment_failed', () => {
  it('merge-blocking: no entitlement, no credit increment, status stays checkout_created — never reuses the failed status', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const { prisma, stripeEventId } = dispatch({ type: 'checkout.session.async_payment_failed', session })

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('async_payment_failed followed later by async_payment_succeeded(paid) still fulfills exactly once', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const sessionId = session.id
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId })],
      stripeWebhookEvent: [],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const failedEvent = buildStripeEvent('checkout.session.async_payment_failed', session, 'evt_sm_async_failed')
    mockConstructEvent(failedEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_sm_async_failed', status: 'PROCESSING', attempts: 1 }))
    await POST(createWebhookRequest())
    expect((await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })).status).toBe('checkout_created')

    const paidSession = { ...session, payment_status: 'paid' }
    const succeededEvent = buildStripeEvent('checkout.session.async_payment_succeeded', paidSession, 'evt_sm_async_succeeded_2')
    mockConstructEvent(succeededEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_sm_async_succeeded_2', status: 'PROCESSING', attempts: 1 }))
    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
  })
})

describe('checkout.session.expired', () => {
  it('checkout_created transitions to expired, receipt PROCESSED atomically', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const { prisma, stripeEventId } = dispatch({ type: 'checkout.session.expired', session })

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('expired')
    expect(checkout.completedAt).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it.each(['auto_created', 'credit_granted', 'failed'])(
    'merge-blocking: never downgrades an already-terminal status (%s)',
    async (terminalStatus) => {
      const session = buildSession({ paymentStatus: 'unpaid' })
      const { prisma } = dispatch({
        type: 'checkout.session.expired',
        session,
        seed: { checkoutOverrides: { status: terminalStatus } },
      })

      const response = await POST(createWebhookRequest())
      expect(response.status).toBe(200)

      const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
      expect(checkout.status).toBe(terminalStatus)
    },
  )

  it('duplicate expired delivery is idempotent (same Stripe event id short-circuits at the receipt layer)', async () => {
    const session = buildSession({ paymentStatus: 'unpaid' })
    const stripeEventId = 'evt_expired_dup'
    const stripeEvent = buildStripeEvent('checkout.session.expired', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'ALREADY_PROCESSED', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: session.id, status: 'expired' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSED', attempts: 1, eventType: 'checkout.session.expired' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('expired')
  })

  it('a paid checkout.session.completed after expiration is never downgraded and never re-fulfilled by expiration racing in', async () => {
    // completed(paid) fulfills first...
    const session = buildSession({ paymentStatus: 'paid' })
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: session.id })],
      stripeWebhookEvent: [],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const completedEvent = buildStripeEvent('checkout.session.completed', session, 'evt_race_completed')
    mockConstructEvent(completedEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_race_completed', status: 'PROCESSING', attempts: 1 }))
    await POST(createWebhookRequest())
    expect((await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })).status).toBe('credit_granted')

    // ...a stray/late expired event for the same session must never
    // downgrade the now-fulfilled row.
    const expiredEvent = buildStripeEvent('checkout.session.expired', session, 'evt_race_expired')
    mockConstructEvent(expiredEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: 'evt_race_expired', status: 'PROCESSING', attempts: 1 }))
    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
  })
})

describe('HANDLED_STRIPE_EVENT_TYPES — exact membership (STEP: billing PR 1)', () => {
  it('unhandled event types are still acknowledged with 200 and never claimed', async () => {
    const stripeEvent = buildStripeEvent('payment_intent.succeeded', {})
    mockConstructEvent(stripeEvent)

    const response = await POST(createWebhookRequest())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(claimStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it.each([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'invoice.payment_succeeded',
  ])('%s is claimed (routed past the unhandled-type short-circuit)', async (type) => {
    const session = type.startsWith('checkout.session') ? buildSession({ paymentStatus: 'unpaid' }) : { id: 'sub_1', status: 'active' }
    const stripeEvent = buildStripeEvent(type, session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: type.startsWith('checkout.session') ? [seedCheckout({ sessionId: session.id })] : [],
      stripeWebhookEvent: [],
    })
    getPrismaClient.mockResolvedValue(prisma)

    await POST(createWebhookRequest())
    expect(claimStripeWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: type }))
  })
})

describe('sibling intent isolation', () => {
  it('async_payment_succeeded for a non-extra_event intent is safely ignored — no dispatch into extra_event fulfillment', async () => {
    const session = { id: 'cs_pro_event', customer: 'cus_test', payment_status: 'paid', metadata: { intent: 'pro_event', ownerId: 'owner-1', eventId: 'event-1' } }
    const stripeEvent = buildStripeEvent('checkout.session.async_payment_succeeded', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    // No business write for this intent — a plain 2xx response is
    // finalized via the wrapper's own fallback, which still needs a real
    // PROCESSING receipt row to update.
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEvent.id, status: 'PROCESSING', attempts: 1, eventType: stripeEvent.type })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)
    expect(prisma.extraFreeEventCheckout._rows).toHaveLength(0)
  })

  it('async_payment_failed for a non-extra_event intent is safely ignored', async () => {
    const session = { id: 'cs_pro_event_2', customer: 'cus_test', metadata: { intent: 'pro_event', ownerId: 'owner-1', eventId: 'event-1' } }
    const stripeEvent = buildStripeEvent('checkout.session.async_payment_failed', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(
      createFakeTransactionalPrisma({
        owner: [seedOwner()],
        stripeWebhookEvent: [seedReceipt({ eventId: stripeEvent.id, status: 'PROCESSING', attempts: 1, eventType: stripeEvent.type })],
      }),
    )

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)
  })

  it('expired for a non-extra_event intent is safely ignored', async () => {
    const session = { id: 'cs_pro_event_3', customer: 'cus_test', metadata: { intent: 'pro_event', ownerId: 'owner-1', eventId: 'event-1' } }
    const stripeEvent = buildStripeEvent('checkout.session.expired', session)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(
      createFakeTransactionalPrisma({
        owner: [seedOwner()],
        stripeWebhookEvent: [seedReceipt({ eventId: stripeEvent.id, status: 'PROCESSING', attempts: 1, eventType: stripeEvent.type })],
      }),
    )

    const response = await POST(createWebhookRequest())
    expect(response.status).toBe(200)
  })
})
