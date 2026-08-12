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
// Deliberately NOT mocked: same reasoning as
// stripe-webhook-extra-event-buy-create-primary-atomic.test.js — the primary
// attempt (which must fail here to trigger the fallback) needs
// prismaGalleryRepository.createEvent to run for real against the fake
// transactional Prisma, so its rollback is genuine, not a stub artifact.
// Only `claimStripeWebhookEvent` is mocked here: these tests are about what
// the atomic buy-and-create FALLBACK branch does with a *given* claimed
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
import {
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
} from '@/lib/server/billing-emails'
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
  return { id: id || `evt_bcf_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ sessionId = 'cs_bcf_test', ownerId = 'owner-1', pendingCheckoutId = 'checkout-1' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
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
// seed time — see stripe-webhook-extra-event-buy-create-primary-atomic.test.js
// for why: the top-level dispatch looks up ExtraFreeEventCheckout by
// stripeCheckoutSessionId, not by the pendingCheckoutId in session.metadata.
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

// Forces the PRIMARY transaction to fail with a plain business error:
// event.create is only ever called by the primary (prismaGalleryRepository.
// createEvent), never by the fallback, so this override is naturally scoped
// to the primary attempt alone.
function forcePrimaryFailure(prisma) {
  const realTransaction = prisma.$transaction
  prisma.$transaction = vi.fn((fn) =>
    realTransaction((tx) => {
      tx.event.create = vi.fn().mockRejectedValue(new Error('event create failed'))
      return fn(tx)
    })
  )
  return prisma
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('STEP 4.10: atomic finalization for checkout.session.completed / extra_event buy-and-create FALLBACK compensation success path', () => {
  it('A: primary failure -> fallback success — credit +1, checkout failed, receipt PROCESSED, atomic, markProcessed once total', async () => {
    const stripeEventId = 'evt_bcf_success'
    const session = buildSession({ sessionId: 'cs_bcf_1', pendingCheckoutId: 'checkout-1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    let prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_bcf_1', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    prisma = forcePrimaryFailure(prisma)
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
    expect(owner.extraEventCheckoutSessionId).toBe('cs_bcf_1')

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('failed')
    expect(checkout.errorMessage).toContain('event create failed')

    // The primary's own Event row never survived.
    expect(prisma.event._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    // Primary never reached its own markProcessed call (it failed at
    // event.create, before that point) — only the fallback's call counts.
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('B (MANDATORY): fallback fencing — fallback rolls back completely, 503, no stale markFailed', async () => {
    const stripeEventId = 'evt_bcf_fencing'
    const session = buildSession({ sessionId: 'cs_bcf_2', pendingCheckoutId: 'checkout-2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    let prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-2', sessionId: 'cs_bcf_2', status: 'checkout_created' })],
      // ...but the receipt already shows attempts=2: another worker
      // reclaimed this delivery's stale lease first. The primary fails on a
      // genuine business error (never reaching its own markProcessed call),
      // so the fencing below is hit for the first time inside the fallback.
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    prisma = forcePrimaryFailure(prisma)
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(owner.extraEventCheckoutSessionId).toBeNull()

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-2' } })
    expect(checkout.status).toBe('checkout_created')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('C: fallback owner.update failure — rollback, non-2xx, markFailed', async () => {
    const stripeEventId = 'evt_bcf_owner_update_fail'
    const session = buildSession({ sessionId: 'cs_bcf_3', pendingCheckoutId: 'checkout-3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-3', sessionId: 'cs_bcf_3', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    // owner.update is only ever called by the fallback (the primary never
    // touches Owner), so this override is naturally scoped to it alone.
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.event.create = vi.fn().mockRejectedValue(new Error('event create failed'))
        tx.owner.update = vi.fn().mockRejectedValue(new Error('owner update failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-3' } })
    expect(checkout.status).toBe('checkout_created')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
  })

  it('D: fallback checkout update failure — rollback credit, non-2xx, markFailed', async () => {
    const stripeEventId = 'evt_bcf_checkout_update_fail'
    const session = buildSession({ sessionId: 'cs_bcf_4', pendingCheckoutId: 'checkout-4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-4', sessionId: 'cs_bcf_4', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    // The primary also calls extraFreeEventCheckout.update, but it never
    // reaches that call here: it fails earlier, at event.create.
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.event.create = vi.fn().mockRejectedValue(new Error('event create failed'))
        tx.extraFreeEventCheckout.update = vi.fn().mockRejectedValue(new Error('checkout update failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    // The credit increment attempted earlier in the same fallback tx must
    // not survive the later checkout-update failure.
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(owner.extraEventCheckoutSessionId).toBeNull()

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-4' } })
    expect(checkout.status).toBe('checkout_created')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
  })

  it('E: both primary and fallback fail — receipt FAILED via wrapper, non-2xx, zero partial state', async () => {
    const stripeEventId = 'evt_bcf_both_fail'
    const session = buildSession({ sessionId: 'cs_bcf_5', pendingCheckoutId: 'checkout-5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    let prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-5', sessionId: 'cs_bcf_5', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    prisma = forcePrimaryFailure(prisma)
    getPrismaClient.mockResolvedValue(prisma)
    // The fallback's own receipt-marking step fails generically (distinct
    // trigger from C/D's owner/checkout write failures) — the first actual
    // invocation of the mock is the fallback's, since the primary never
    // reaches its own call.
    markStripeWebhookEventProcessed.mockRejectedValueOnce(new Error('receipt marking blip'))

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-5' } })
    expect(checkout.status).toBe('checkout_created')

    expect(prisma.event._rows).toHaveLength(0)

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
    expect(sendExtraFreeEventCreatedEmail).not.toHaveBeenCalled()
  })

  it('F: fallback email/PostHog side effects see the root already committed: credit +1, checkout failed, receipt PROCESSED', async () => {
    const stripeEventId = 'evt_bcf_side_effect_order'
    const session = buildSession({ sessionId: 'cs_bcf_6', pendingCheckoutId: 'checkout-6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    let prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-6', sessionId: 'cs_bcf_6', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    prisma = forcePrimaryFailure(prisma)
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendExtraFreeEventFallbackCreditEmail.mockImplementation(async ({ owner }) => {
      const ownerRow = await prisma.owner.findUnique({ where: { id: owner.id } })
      const checkoutRow = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-6' } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        extraEventCredits: ownerRow?.extraEventCredits,
        checkoutStatus: checkoutRow?.status,
        receiptStatus: receiptRow?.status,
      }
    })

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const ownerRow = prisma.owner._rows.find((r) => r.id === 'owner-1')
        const checkoutRow = prisma.extraFreeEventCheckout._rows.find((r) => r.id === 'checkout-6')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          extraEventCredits: ownerRow?.extraEventCredits,
          checkoutStatus: checkoutRow?.status,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendExtraFreeEventFallbackCreditEmail).toHaveBeenCalledTimes(1)
    expect(trackServerEvent).toHaveBeenCalled()

    const expectedCommittedState = {
      extraEventCredits: 1,
      checkoutStatus: 'failed',
      receiptStatus: 'PROCESSED',
    }
    expect(committedStateWhenEmailed).toEqual(expectedCommittedState)
    expect(committedStateWhenTracked).toEqual(expectedCommittedState)
  })

  it('G: no double finalization — markProcessed once (fallback only), markFailed never, two total $transaction calls', async () => {
    const stripeEventId = 'evt_bcf_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_bcf_7', pendingCheckoutId: 'checkout-7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    let prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-7', sessionId: 'cs_bcf_7', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    prisma = forcePrimaryFailure(prisma)
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
    // One failed primary $transaction call, one successful fallback $transaction call.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })

  it('H: primary success regression — fallback never runs, STEP 4.9 behavior unchanged', async () => {
    const stripeEventId = 'evt_bcf_primary_success_regression'
    const session = buildSession({ sessionId: 'cs_bcf_8', pendingCheckoutId: 'checkout-8' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-8', sessionId: 'cs_bcf_8', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.event._rows).toHaveLength(1)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-8' } })
    expect(checkout.status).toBe('auto_created')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    expect(sendExtraFreeEventCreatedEmail).toHaveBeenCalledTimes(1)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('I: primary fencing regression — fallback never runs, 503, no markFailed', async () => {
    const stripeEventId = 'evt_bcf_primary_fencing_regression'
    const session = buildSession({ sessionId: 'cs_bcf_9', pendingCheckoutId: 'checkout-9' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1, but the receipt already
    // shows attempts=2 — primary hits fencing directly (no injected
    // business error), exactly as in STEP 4.9.
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ id: 'checkout-9', sessionId: 'cs_bcf_9', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    expect(prisma.event._rows).toHaveLength(0)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
    // Only the one (rolled-back) primary $transaction call — fallback never started.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})
