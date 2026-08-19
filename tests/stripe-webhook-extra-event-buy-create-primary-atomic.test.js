import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

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
// Deliberately NOT mocked: this file needs prismaGalleryRepository.createEvent
// to actually run prisma.event.create/findUnique against the fake
// transactional Prisma below, so a fencing/business rollback genuinely
// discards the Event row instead of trivially "succeeding" against a stub.
// Only `claimStripeWebhookEvent` is mocked here: these tests are about what
// the atomic buy-and-create PRIMARY branch does with a *given* claimed
// attempt, not about the claim/lease mechanism itself (already covered
// exhaustively in tests/stripe-webhook-receipt.test.js).
// markStripeWebhookEventProcessed/Failed keep their real implementation —
// wrapped in vi.fn() so calls are still countable — so fencing/finalization
// run for real against the fake transactional store below.
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
import { sendExtraFreeEventCreatedEmail, sendExtraFreeEventFallbackCreditEmail } from '@/lib/server/billing-emails'
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
  return { id: id || `evt_bc_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ sessionId = 'cs_bc_test', ownerId = 'owner-1', pendingCheckoutId = 'checkout-1' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    payment_status: 'paid',
    customer_email: 'owner@example.com',
    metadata: {
      intent: 'extra_event',
      ownerId,
      ownerEmail: 'owner@example.com',
      postPurchaseAction: 'create_event',
      pendingCheckoutId,
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
  return {
    id: `swe-seed-${eventId}`,
    eventId,
    eventType,
    status,
    attempts,
    lastError: null,
    receivedAt: new Date(),
    processingStartedAt: new Date(),
    processedAt: null,
    updatedAt: new Date(),
  }
}

function seedOwner({ id = 'owner-1', extraEventCredits = 0, extraEventCheckoutSessionId = null } = {}) {
  return { id, email: 'owner@example.com', extraEventCredits, extraEventCheckoutSessionId }
}

// stripeCheckoutSessionId must already equal the checkout session's id at
// seed time: the top-level dispatch in handleCheckoutSessionCompleted looks
// up ExtraFreeEventCheckout by stripeCheckoutSessionId (not by the
// pendingCheckoutId in session.metadata, which fulfillExtraFreeEventBuyAndCreate
// looks up separately, by id) to decide the canonical vs. legacy branch —
// exactly like real checkout-session creation pre-populates it.
function seedCheckout({ id = 'checkout-1', sessionId, ownerId = 'owner-1', eventName = 'Birthday Party', status = 'checkout_created' } = {}) {
  return {
    id,
    ownerId,
    stripeCheckoutSessionId: sessionId,
    eventName,
    status,
    createdEventId: null,
    createdEventSlug: null,
    errorMessage: null,
    completedAt: null,
    autoCreatedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('STEP 4.9: atomic finalization for checkout.session.completed / extra_event buy-and-create PRIMARY success path', () => {
  it('A: primary success — Event created, owner association, checkout auto_created, receipt PROCESSED, all atomic', async () => {
    const stripeEventId = 'evt_bc_success'
    const session = buildSession({ sessionId: 'cs_bc_1', pendingCheckoutId: 'checkout-1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_bc_1', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.event._rows).toHaveLength(1)
    const event = prisma.event._rows[0]
    expect(event.ownerId).toBe('owner-1')
    expect(event.ownerEmail).toBe('owner@example.com')
    expect(event.name).toBe('Birthday Party')

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('auto_created')
    expect(checkout.createdEventId).toBe(event.id)
    expect(checkout.createdEventSlug).toBe(event.slug)
    expect(checkout.stripeCheckoutSessionId).toBe('cs_bc_1')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )

    // Fallback credit was never granted.
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
  })

  it('B (MANDATORY): fencing rollback — Event, checkout, and everything else stay untouched; 503, no fallback, no stale markFailed', async () => {
    const stripeEventId = 'evt_bc_fencing'
    const session = buildSession({ sessionId: 'cs_bc_2', pendingCheckoutId: 'checkout-2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-2', sessionId: 'cs_bc_2', status: 'checkout_created' })],
      // ...but the receipt already shows attempts=2: another worker
      // reclaimed this delivery's stale lease first. createEvent and the
      // checkout update below both run for real inside the primary tx
      // before markStripeWebhookEventProcessed hits the fencing check.
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    // The Event created inside the rolled-back primary tx must not survive.
    expect(prisma.event._rows).toHaveLength(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-2' } })
    expect(checkout.status).toBe('checkout_created')
    expect(checkout.createdEventId).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    // Fencing must NOT trigger the fallback compensation.
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('C: createEvent failure — primary rolls back, but the fallback saga still activates (STEP 4.9 must not break it)', async () => {
    const stripeEventId = 'evt_bc_create_fail'
    const session = buildSession({ sessionId: 'cs_bc_3', pendingCheckoutId: 'checkout-3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-3', sessionId: 'cs_bc_3', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    // Force prismaGalleryRepository.createEvent's own prisma.event.create
    // call to fail, but only inside the PRIMARY transaction — the fallback
    // transaction never calls event.create at all, so this is scoped
    // correctly by construction.
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.event.create = vi.fn().mockRejectedValue(new Error('event create failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.event._rows).toHaveLength(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-3' } })
    expect(checkout.status).toBe('failed')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    expect(sendExtraFreeEventFallbackCreditEmail).toHaveBeenCalledTimes(1)
    expect(sendExtraFreeEventCreatedEmail).not.toHaveBeenCalled()

    // The saga's own (unchanged) finalization: wrapper standalone markProcessed.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('D: pendingCheckout update failure — primary rolls back, fallback still activates', async () => {
    const stripeEventId = 'evt_bc_checkout_update_fail'
    const session = buildSession({ sessionId: 'cs_bc_4', pendingCheckoutId: 'checkout-4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-4', sessionId: 'cs_bc_4', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    // Fail extraFreeEventCheckout.update only on its first invocation (the
    // primary tx's auto_created transition). The fallback tx's own
    // (different) update call — setting status: 'failed' — must still
    // succeed normally on its later, separate $transaction call.
    const realTransaction = prisma.$transaction
    let transactionCallCount = 0
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        transactionCallCount += 1
        if (transactionCallCount === 1) {
          tx.extraFreeEventCheckout.update = vi.fn().mockRejectedValue(new Error('checkout update failed'))
        }
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    // Primary rolled back: no Event survives even though createEvent itself succeeded.
    expect(prisma.event._rows).toHaveLength(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-4' } })
    expect(checkout.status).toBe('failed')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    expect(sendExtraFreeEventFallbackCreditEmail).toHaveBeenCalledTimes(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('E: primary success never activates the fallback', async () => {
    const stripeEventId = 'evt_bc_no_fallback'
    const session = buildSession({ sessionId: 'cs_bc_5', pendingCheckoutId: 'checkout-5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-5', sessionId: 'cs_bc_5', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
    expect(sendExtraFreeEventCreatedEmail).toHaveBeenCalledTimes(1)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-5' } })
    expect(checkout.status).toBe('auto_created')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('F: race lost after FOR UPDATE — re-read inside the transaction finds a terminal status, no new business write', async () => {
    const stripeEventId = 'evt_bc_race_lost'
    const session = buildSession({ sessionId: 'cs_bc_6', pendingCheckoutId: 'checkout-6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      // Non-terminal at the initial (pre-transaction) read...
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-6', sessionId: 'cs_bc_6', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        // ...but another delivery reached a terminal status between the
        // initial read and this worker's FOR UPDATE lock.
        tx.extraFreeEventCheckout.findUnique = vi.fn().mockResolvedValue({
          id: 'checkout-6',
          ownerId: 'owner-1',
          eventName: 'Birthday Party',
          status: 'auto_created',
        })
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.event._rows).toHaveLength(0)

    // Finalized via the wrapper's standalone markProcessed on the legacy
    // 200 response, not via a tagged outcome from an uncommitted transaction.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('G: side effects (email/PostHog) see the root already committed: Event present, checkout auto_created, receipt PROCESSED', async () => {
    const stripeEventId = 'evt_bc_side_effect_order'
    const session = buildSession({ sessionId: 'cs_bc_7', pendingCheckoutId: 'checkout-7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-7', sessionId: 'cs_bc_7', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendExtraFreeEventCreatedEmail.mockImplementation(async ({ event }) => {
      const checkoutRow = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-7' } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        eventExists: prisma.event._rows.some((r) => r.id === event.id),
        checkoutStatus: checkoutRow?.status,
        receiptStatus: receiptRow?.status,
      }
    })

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const checkoutRow = prisma.extraFreeEventCheckout._rows.find((r) => r.id === 'checkout-7')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          eventExists: prisma.event._rows.length === 1,
          checkoutStatus: checkoutRow?.status,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendExtraFreeEventCreatedEmail).toHaveBeenCalledTimes(1)
    expect(trackServerEvent).toHaveBeenCalled()

    const expectedCommittedState = {
      eventExists: true,
      checkoutStatus: 'auto_created',
      receiptStatus: 'PROCESSED',
    }
    expect(committedStateWhenEmailed).toEqual(expectedCommittedState)
    expect(committedStateWhenTracked).toEqual(expectedCommittedState)
  })

  it('H: markStripeWebhookEventProcessed runs exactly once, from inside the primary transaction — no double finalization', async () => {
    const stripeEventId = 'evt_bc_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_bc_8', pendingCheckoutId: 'checkout-8' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-8', sessionId: 'cs_bc_8', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
