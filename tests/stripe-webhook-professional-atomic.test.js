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
// the atomic professional branch does with a *given* claimed attempt, not
// about the claim/lease mechanism itself (already covered exhaustively in
// tests/stripe-webhook-receipt.test.js). markStripeWebhookEventProcessed/
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
import { sendProfessionalActivatedEmail } from '@/lib/server/billing-emails'
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
  return { id: id || `evt_prof_atomic_${eventIdSeq}`, type, data: { object } }
}

function buildSession({ sessionId = 'cs_prof_test', ownerId = 'owner-1', billingInterval = 'monthly' } = {}) {
  return {
    id: sessionId,
    customer: 'cus_test',
    customer_email: 'owner@example.com',
    subscription: 'sub_test_1',
    metadata: {
      intent: 'professional',
      ownerId,
      ownerEmail: 'owner@example.com',
      billingInterval,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('STEP 4.6: atomic finalization for checkout.session.completed / professional', () => {
  it('A: success — Owner upgrade, UpsellEvent, and receipt PROCESSED all commit together', async () => {
    const stripeEventId = 'evt_prof_success'
    const session = buildSession({ sessionId: 'cs_prof_1' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('professional')
    expect(owner.subscriptionStatus).toBe('active')
    expect(owner.stripeCheckoutSessionId).toBe('cs_prof_1')

    expect(prisma.upsellEvent._rows).toHaveLength(1)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('B: an UpsellEvent write failure rolls back the Owner upgrade too — no partial fulfillment', async () => {
    const stripeEventId = 'evt_prof_upsell_fail'
    const session = buildSession({ sessionId: 'cs_prof_2' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
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
    expect(owner.plan).toBe('free')
    expect(owner.stripeCheckoutSessionId).toBeNull()

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('C: rolls back Owner and UpsellEvent writes when markProcessed hits fencing', async () => {
    const stripeEventId = 'evt_prof_fencing'
    const session = buildSession({ sessionId: 'cs_prof_3' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
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
    expect(owner.plan).toBe('free')

    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: an already-fulfilled Owner (matching stripeCheckoutSessionId) skips the transaction', async () => {
    const stripeEventId = 'evt_prof_already'
    const session = buildSession({ sessionId: 'cs_prof_4' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'professional', subscriptionStatus: 'active', stripeCheckoutSessionId: 'cs_prof_4' }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.upsellEvent._rows).toHaveLength(0)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('E: an Owner.update P2025 stays a legitimate skip, never a finalized (tagged) receipt', async () => {
    const stripeEventId = 'evt_prof_p2025'
    const session = buildSession({ sessionId: 'cs_prof_5' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
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

  it('F: the activation email fires only after the transaction has committed', async () => {
    const stripeEventId = 'evt_prof_email_order'
    const session = buildSession({ sessionId: 'cs_prof_6' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenEmailed = null
    sendProfessionalActivatedEmail.mockImplementation(async ({ owner }) => {
      const ownerRow = await prisma.owner.findUnique({ where: { id: owner.id } })
      const receiptRow = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
      committedStateWhenEmailed = {
        plan: ownerRow?.plan,
        upsellCount: prisma.upsellEvent._rows.length,
        receiptStatus: receiptRow?.status,
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendProfessionalActivatedEmail).toHaveBeenCalledTimes(1)
    expect(committedStateWhenEmailed).toEqual({
      plan: 'professional',
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    })
  })

  it('G: trackServerEvent (PostHog) fires only after the transaction has committed', async () => {
    const stripeEventId = 'evt_prof_posthog_order'
    const session = buildSession({ sessionId: 'cs_prof_7' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStateWhenTracked = null
    // Synchronous on purpose — matches the real trackServerEvent's own
    // synchronous, fire-and-forget nature.
    trackServerEvent.mockImplementation(() => {
      if (committedStateWhenTracked === null) {
        const ownerRow = prisma.owner._rows.find((r) => r.id === 'owner-1')
        const receiptRow = prisma.stripeWebhookEvent._rows.find((r) => r.eventId === stripeEventId)
        committedStateWhenTracked = {
          plan: ownerRow?.plan,
          upsellCount: prisma.upsellEvent._rows.length,
          receiptStatus: receiptRow?.status,
        }
      }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(trackServerEvent).toHaveBeenCalled()
    expect(committedStateWhenTracked).toEqual({
      plan: 'professional',
      upsellCount: 1,
      receiptStatus: 'PROCESSED',
    })
  })

  it('H: markStripeWebhookEventProcessed runs exactly once, from inside the transaction', async () => {
    const stripeEventId = 'evt_prof_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_prof_8' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null, stripeCheckoutSessionId: null }],
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
  })
})

describe('STEP 5.5: billing cursor scope initialization on professional checkout', () => {
  it('A: success — stripeBillingCursorSubscriptionId matches stripeSubscriptionId, both markers null, all committed', async () => {
    const stripeEventId = 'evt_cursor_success'
    const session = buildSession({ sessionId: 'cs_cursor_a' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null,
        stripeCheckoutSessionId: null, stripeSubscriptionId: null,
        stripeBillingCursorSubscriptionId: null,
        lastStripeSubscriptionEventCreated: null, lastStripeInvoiceEventCreated: null,
      }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.stripeSubscriptionId).toBe('sub_test_1')
    expect(owner.stripeBillingCursorSubscriptionId).toBe('sub_test_1')
    expect(owner.lastStripeSubscriptionEventCreated).toBeNull()
    expect(owner.lastStripeInvoiceEventCreated).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('B: fencing rollback — scope/subscription fields stay at their pre-transaction values', async () => {
    const stripeEventId = 'evt_cursor_fencing'
    const session = buildSession({ sessionId: 'cs_cursor_b' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null,
        stripeCheckoutSessionId: null, stripeSubscriptionId: null,
        stripeBillingCursorSubscriptionId: null,
        lastStripeSubscriptionEventCreated: null, lastStripeInvoiceEventCreated: null,
      }],
      // Another worker reclaimed this delivery's stale lease first.
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(503)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.stripeSubscriptionId).toBeNull()
    expect(owner.stripeBillingCursorSubscriptionId).toBeNull()
    expect(owner.lastStripeSubscriptionEventCreated).toBeNull()
    expect(owner.lastStripeInvoiceEventCreated).toBeNull()

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('C: transaction failure rollback — cursor fields never advance on a failed write', async () => {
    const stripeEventId = 'evt_cursor_tx_fail'
    const session = buildSession({ sessionId: 'cs_cursor_c' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null,
        stripeCheckoutSessionId: null, stripeSubscriptionId: null,
        stripeBillingCursorSubscriptionId: null,
        lastStripeSubscriptionEventCreated: null, lastStripeInvoiceEventCreated: null,
      }],
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
    expect(owner.stripeSubscriptionId).toBeNull()
    expect(owner.stripeBillingCursorSubscriptionId).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: stripeEventId } })
    expect(receipt.status).toBe('FAILED')
  })

  it('D: duplicate/already-fulfilled delivery does not reset markers already advanced by a later webhook', async () => {
    const stripeEventId = 'evt_cursor_duplicate'
    const session = buildSession({ sessionId: 'cs_cursor_d' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    // Owner already fulfilled for this exact session (stripeCheckoutSessionId
    // match), and a *later* subscription.updated webhook has already
    // advanced the cursor markers past null. A duplicate delivery of the
    // original checkout.session.completed must not regress them.
    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'professional', subscriptionStatus: 'active',
        stripeCheckoutSessionId: 'cs_cursor_d', stripeSubscriptionId: 'sub_test_1',
        stripeBillingCursorSubscriptionId: 'sub_test_1',
        lastStripeSubscriptionEventCreated: 500n, lastStripeInvoiceEventCreated: 400n,
      }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.stripeBillingCursorSubscriptionId).toBe('sub_test_1')
    expect(owner.lastStripeSubscriptionEventCreated).toBe(500n)
    expect(owner.lastStripeInvoiceEventCreated).toBe(400n)
  })

  it('E: a new professional checkout for a different subscription resets scope and both markers', async () => {
    const stripeEventId = 'evt_cursor_resub'
    const session = buildSession({ sessionId: 'cs_cursor_e' })
    session.subscription = 'sub_B'
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    // Owner previously had subscription A, fully bootstrapped/advanced.
    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: 'canceled',
        stripeCheckoutSessionId: 'cs_prof_old', stripeSubscriptionId: 'sub_A',
        stripeBillingCursorSubscriptionId: 'sub_A',
        lastStripeSubscriptionEventCreated: 700n, lastStripeInvoiceEventCreated: 650n,
      }],
      stripeWebhookEvent: [seedReceipt({ eventId: stripeEventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.stripeSubscriptionId).toBe('sub_B')
    expect(owner.stripeBillingCursorSubscriptionId).toBe('sub_B')
    expect(owner.lastStripeSubscriptionEventCreated).toBeNull()
    expect(owner.lastStripeInvoiceEventCreated).toBeNull()
  })

  it('F: no double finalization — markStripeWebhookEventProcessed runs exactly once with cursor fields set', async () => {
    const stripeEventId = 'evt_cursor_no_double_finalize'
    const session = buildSession({ sessionId: 'cs_cursor_f' })
    const stripeEvent = buildStripeEvent('checkout.session.completed', session, stripeEventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{
        id: 'owner-1', email: 'owner@example.com', plan: 'free', subscriptionStatus: null,
        stripeCheckoutSessionId: null, stripeSubscriptionId: null,
        stripeBillingCursorSubscriptionId: null,
        lastStripeSubscriptionEventCreated: null, lastStripeInvoiceEventCreated: null,
      }],
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

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.stripeBillingCursorSubscriptionId).toBe('sub_test_1')
  })
})
