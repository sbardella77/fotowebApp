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
vi.mock('@/lib/server/prisma-gallery-repository', () => ({
  prismaGalleryRepository: { createEvent: vi.fn() },
}))
// Only `claimStripeWebhookEvent` is mocked here: these tests are about what
// the atomic extra_event canonical credit branch does with a *given* claimed
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
import { sendExtraFreeEventCreditGrantedEmail } from '@/lib/server/billing-emails'
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
  return { id: id || `evt_ex_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ sessionId = 'cs_ex_test', ownerId = 'owner-1', postPurchaseAction = 'credit_only' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    payment_status: 'paid',
    customer_email: 'owner@example.com',
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

function seedCheckout({ id = 'checkout-1', ownerId = 'owner-1', sessionId, status = 'checkout_created' } = {}) {
  return {
    id,
    ownerId,
    stripeCheckoutSessionId: sessionId,
    eventName: null,
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

describe('STEP 4.7: atomic finalization for checkout.session.completed / extra_event canonical credit path', () => {
  it('A: canonical success — credit incremented, checkout credit_granted, UpsellEvent present, receipt PROCESSED', async () => {
    const stripeEventId = 'evt_ex_success'
    const session = buildSession({ sessionId: 'cs_ex_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_1', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
    expect(owner.extraEventCheckoutSessionId).toBe('cs_ex_1')

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    expect(checkout.stripeCheckoutSessionId).toBe('cs_ex_1')
    expect(checkout.completedAt).not.toBeNull()

    expect(prisma.upsellEvent._rows).toHaveLength(1)
    expect(prisma.upsellEvent._rows[0].ownerId).toBe('owner-1')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: stripeEventId, attempt: 1 })
    )
  })

  it('B: fencing rollback — credit, checkout, and UpsellEvent all stay untouched; 503, no stale markFailed', async () => {
    const stripeEventId = 'evt_ex_fencing'
    const session = buildSession({ sessionId: 'cs_ex_2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_2', status: 'checkout_created' })],
      // ...but the receipt already shows attempts=2: another worker
      // reclaimed this delivery's stale lease first.
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('C: an UpsellEvent write failure rolls back the credit and checkout status too — no partial fulfillment', async () => {
    const stripeEventId = 'evt_ex_upsell_fail'
    const session = buildSession({ sessionId: 'cs_ex_3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_3', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.upsellEvent.create = vi.fn().mockRejectedValue(new Error('upsell write failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(owner.extraEventCheckoutSessionId).toBeNull()

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('D: race lost after FOR UPDATE — re-read inside the transaction finds a terminal status, no new business write', async () => {
    const stripeEventId = 'evt_ex_race_lost'
    const session = buildSession({ sessionId: 'cs_ex_4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      // Non-terminal at the initial (pre-transaction) read...
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_4', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        // ...but another delivery reached a terminal status between the
        // initial read and this worker's FOR UPDATE lock.
        tx.extraFreeEventCheckout.findUnique = vi.fn().mockResolvedValue({
          id: 'checkout-1',
          ownerId: 'owner-1',
          stripeCheckoutSessionId: 'cs_ex_4',
          status: 'credit_granted',
        })
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    // Finalized via the wrapper's standalone markProcessed on the legacy
    // 200 response, not via a tagged outcome from an uncommitted transaction.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('E: checkout already terminal — guarded skip inside one transaction, no new credit', async () => {
    // STEP: billing PR 1 unified the fast pre-check into the same
    // lock+fresh-read transaction used for a real fulfillment, so the
    // receipt can be finalized atomically with the (no-op) outcome instead
    // of relying on the wrapper's separate fallback finalization. One
    // transaction now runs for every terminal branch, fulfilled or skipped
    // — the assertion here is "no new credit", not "no transaction at all".
    const stripeEventId = 'evt_ex_already_terminal'
    const session = buildSession({ sessionId: 'cs_ex_5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner({ extraEventCredits: 1, extraEventCheckoutSessionId: 'cs_ex_5' })],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_5', status: 'credit_granted' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('F: email and PostHog side effects fire only after the transaction has committed', async () => {
    const stripeEventId = 'evt_ex_side_effect_order'
    const session = buildSession({ sessionId: 'cs_ex_6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_6', status: 'checkout_created' })],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendExtraFreeEventCreditGrantedEmail.mockImplementation(async ({ owner }) => {
      const ownerRow = await prisma.owner.findUnique({ where: { id: owner.id } })
      const checkoutRow = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        extraEventCredits: ownerRow?.extraEventCredits,
        checkoutStatus: checkoutRow?.status,
        upsellCount: prisma.upsellEvent._rows.length,
        receiptStatus: receiptRow?.status,
      }
    })

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const ownerRow = prisma.owner._rows.find((r) => r.id === 'owner-1')
        const checkoutRow = prisma.extraFreeEventCheckout._rows.find((r) => r.id === 'checkout-1')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          extraEventCredits: ownerRow?.extraEventCredits,
          checkoutStatus: checkoutRow?.status,
          upsellCount: prisma.upsellEvent._rows.length,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendExtraFreeEventCreditGrantedEmail).toHaveBeenCalledTimes(1)
    expect(trackServerEvent).toHaveBeenCalled()

    const expectedCommittedState = {
      extraEventCredits: 1,
      checkoutStatus: 'credit_granted',
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    }
    expect(committedStateWhenEmailed).toEqual(expectedCommittedState)
    expect(committedStateWhenTracked).toEqual(expectedCommittedState)
  })

  it('G: markStripeWebhookEventProcessed runs exactly once, from inside the transaction — no double finalization', async () => {
    const stripeEventId = 'evt_ex_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_ex_7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [seedCheckout({ sessionId: 'cs_ex_7', status: 'checkout_created' })],
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

  it('H: legacy extra_event (no pendingCheckout row) never touches ExtraFreeEventCheckout / the canonical state machine', async () => {
    // As of STEP 4.8 the legacy path (no pendingCheckout row) is also
    // atomic — see tests/stripe-webhook-extra-event-legacy-atomic.test.js
    // for its own dedicated transaction/fencing/rollback coverage. What
    // this test protects here is narrower and specific to this file's
    // STEP 4.7 scope: a session with no pendingCheckout row must never
    // read or write ExtraFreeEventCheckout, i.e. it never runs through
    // fulfillExtraFreeEventCreditCanonical's state machine.
    const stripeEventId = 'evt_ex_legacy'
    const session = buildSession({ sessionId: 'cs_ex_legacy' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      // No extraFreeEventCheckout row seeded for this session: the lookup
      // by stripeCheckoutSessionId falls through to the legacy path.
      extraFreeEventCheckout: [],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
    expect(owner.extraEventCheckoutSessionId).toBe('cs_ex_legacy')

    // No ExtraFreeEventCheckout row was created or touched: the legacy
    // path never runs the canonical pendingCheckout state machine.
    expect(prisma.extraFreeEventCheckout._rows).toHaveLength(0)

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })
})
