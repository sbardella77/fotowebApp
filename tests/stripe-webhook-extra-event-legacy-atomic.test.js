import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

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
// the atomic legacy extra_event branch does with a *given* claimed attempt,
// not about the claim/lease mechanism itself (already covered exhaustively
// in tests/stripe-webhook-receipt.test.js). markStripeWebhookEventProcessed/
// Failed keep their real implementation — wrapped in vi.fn() so calls are
// still countable — so fencing/finalization run for real against the fake
// transactional store below.
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
  return { id: id || `evt_ex_legacy_atomic_${eventIdSeq}`, type, data: { object } }
}

// Legacy sessions carry no pendingCheckoutId in metadata at all — that's
// exactly what makes the lookup by stripeCheckoutSessionId miss and fall
// through to this path.
function buildSession({ sessionId = 'cs_ex_legacy_test', ownerId = 'owner-1' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'owner@example.com',
    metadata: {
      intent: 'extra_event',
      ownerId,
      ownerEmail: 'owner@example.com',
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('STEP 4.8: atomic finalization for checkout.session.completed / extra_event legacy credit path (no pendingCheckout)', () => {
  it('A: success — credit incremented, marker set, UpsellEvent present, receipt PROCESSED, all atomic', async () => {
    const stripeEventId = 'evt_exl_success'
    const session = buildSession({ sessionId: 'cs_exl_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      // No extraFreeEventCheckout row at all: legacy path.
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
    expect(owner.extraEventCheckoutSessionId).toBe('cs_exl_1')

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

  it('B: an UpsellEvent write failure rolls back the credit and marker too — no partial fulfillment', async () => {
    const stripeEventId = 'evt_exl_upsell_fail'
    const session = buildSession({ sessionId: 'cs_exl_2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
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

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('C: fencing rollback — credit, marker, and UpsellEvent all stay untouched; 503, no stale markFailed', async () => {
    const stripeEventId = 'evt_exl_fencing'
    const session = buildSession({ sessionId: 'cs_exl_3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
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
    expect(owner.extraEventCheckoutSessionId).toBeNull()

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: already fulfilled (matching extraEventCheckoutSessionId) skips the transaction entirely', async () => {
    const stripeEventId = 'evt_exl_already'
    const session = buildSession({ sessionId: 'cs_exl_4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner({ extraEventCredits: 1, extraEventCheckoutSessionId: 'cs_exl_4' })],
      extraFreeEventCheckout: [],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    // Finalized via the wrapper's standalone markProcessed on the legacy
    // 200 response, not via a tagged outcome from an uncommitted transaction.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('E: an Owner.update P2025 stays a legitimate skip, never a finalized (tagged) receipt', async () => {
    const stripeEventId = 'evt_exl_p2025'
    const session = buildSession({ sessionId: 'cs_exl_5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.owner.update = vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Record to update not found.', { code: 'P2025', clientVersion: '6.9.0' })
        )
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    // Finalized via the wrapper's standalone markProcessed on the legacy
    // 200 response, not via a tagged outcome from an uncommitted transaction.
    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('F: email and PostHog side effects fire only after the transaction has committed', async () => {
    const stripeEventId = 'evt_exl_side_effect_order'
    const session = buildSession({ sessionId: 'cs_exl_6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendExtraFreeEventCreditGrantedEmail.mockImplementation(async ({ owner }) => {
      const ownerRow = await prisma.owner.findUnique({ where: { id: owner.id } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        extraEventCredits: ownerRow?.extraEventCredits,
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
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          extraEventCredits: ownerRow?.extraEventCredits,
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
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    }
    expect(committedStateWhenEmailed).toEqual(expectedCommittedState)
    expect(committedStateWhenTracked).toEqual(expectedCommittedState)
  })

  it('G: markStripeWebhookEventProcessed runs exactly once, from inside the transaction — no double finalization', async () => {
    const stripeEventId = 'evt_exl_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_exl_7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      extraFreeEventCheckout: [],
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

  it('H: canonical extra_event (with pendingCheckout) stays on the STEP 4.7 path — never routes through the legacy transaction', async () => {
    const stripeEventId = 'evt_exl_canonical_regression'
    const session = buildSession({ sessionId: 'cs_exl_canonical' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner()],
      // A pendingCheckout row DOES exist for this session: the canonical
      // STEP 4.7 path must be taken, not this step's legacy transaction.
      extraFreeEventCheckout: [
        {
          id: 'checkout-canonical-1',
          ownerId: 'owner-1',
          stripeCheckoutSessionId: 'cs_exl_canonical',
          eventName: null,
          status: 'checkout_created',
          createdEventId: null,
          createdEventSlug: null,
          errorMessage: null,
          completedAt: null,
          autoCreatedAt: null,
        },
      ],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)

    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-canonical-1' } })
    // Canonical-path marker: status transitions to credit_granted, the
    // legacy path never touches ExtraFreeEventCheckout at all.
    expect(checkout.status).toBe('credit_granted')

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })
})
