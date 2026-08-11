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
// the atomic invoice handlers do with a *given* claimed attempt, not about
// the claim/lease mechanism itself (already covered exhaustively in
// tests/stripe-webhook-receipt.test.js). markStripeWebhookEventProcessed and
// markStripeWebhookEventFailed keep their real implementation — wrapped in
// vi.fn() so calls are still countable — so fencing/finalization run for
// real against the fake transactional store below.
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
import { sendProfessionalPaymentFailedEmail } from '@/lib/server/billing-emails'
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
  return { id: id || `evt_invoice_atomic_${eventIdSeq}`, type, data: { object } }
}

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

function seedReceipt({ eventId, status, attempts, eventType = 'invoice.payment_failed' }) {
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

describe('STEP 4.4: atomic finalization for invoice.payment_failed/succeeded', () => {
  it('A: invoice.payment_failed commits the owner write and the receipt PROCESSED together', async () => {
    const eventId = 'evt_invoice_failed_success'
    const invoice = { id: 'in_1', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.subscriptionStatus).toBe('past_due')
    expect(owner.lastInvoiceId).toBe('in_1')
    expect(owner.paymentFailedAt).toBeInstanceOf(Date)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('B: invoice.payment_succeeded commits the owner write and the receipt PROCESSED together', async () => {
    const eventId = 'evt_invoice_succeeded_success'
    const invoice = { id: 'in_2', subscription: 'sub_1', customer: 'cus_1', status: 'paid' }
    const stripeEvent = buildStripeEvent('invoice.payment_succeeded', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'past_due', paymentFailedAt: new Date(), lastInvoiceId: 'in_old' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1, eventType: 'invoice.payment_succeeded' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.subscriptionStatus).toBe('active')
    expect(owner.lastInvoiceId).toBe('in_2')
    expect(owner.paymentFailedAt).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('C: invoice.payment_failed rolls back the owner write when markProcessed hits fencing', async () => {
    const eventId = 'evt_invoice_failed_fencing'
    const invoice = { id: 'in_3', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }],
      // ...but the receipt already shows attempts=2: another worker
      // reclaimed this delivery's stale lease first.
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.subscriptionStatus).toBe('active')
    expect(owner.lastInvoiceId).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: invoice.payment_succeeded rolls back the owner write when markProcessed hits fencing', async () => {
    const eventId = 'evt_invoice_succeeded_fencing'
    const invoice = { id: 'in_4', subscription: 'sub_1', customer: 'cus_1', status: 'paid' }
    const stripeEvent = buildStripeEvent('invoice.payment_succeeded', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'past_due', paymentFailedAt: new Date(), lastInvoiceId: 'in_old' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2, eventType: 'invoice.payment_succeeded' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.subscriptionStatus).toBe('past_due')
    expect(owner.lastInvoiceId).toBe('in_old')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('E: a generic write failure inside the transaction rolls back and marks the receipt FAILED', async () => {
    const eventId = 'evt_invoice_failed_generic_fail'
    const invoice = { id: 'in_5', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    // Inject a failure into the write the handler performs inside its own
    // transaction — the fake-prisma tx client is rebuilt fresh per
    // $transaction call, so this wraps the real one to intercept it.
    const realTransaction = prisma.$transaction
    prisma.$transaction = vi.fn((fn) =>
      realTransaction((tx) => {
        tx.owner.update = vi.fn().mockRejectedValue(new Error('write failed'))
        return fn(tx)
      })
    )
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(500)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.subscriptionStatus).toBe('active')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('F: a duplicate invoice.payment_failed (already handled) skips the transaction entirely', async () => {
    const eventId = 'evt_invoice_failed_duplicate'
    const invoice = { id: 'in_dup', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      // isPaymentFailureAlreadyHandled: same invoice id + paymentFailedAt already set.
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'past_due', lastInvoiceId: 'in_dup', paymentFailedAt: new Date() }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(body.duplicate).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('G: invoice.payment_failed with no matching owner skips the transaction entirely', async () => {
    const eventId = 'evt_invoice_failed_no_owner'
    const invoice = { id: 'in_6', subscription: 'sub_missing', customer: 'cus_missing', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('G2: invoice.payment_succeeded with no matching owner skips the transaction entirely', async () => {
    const eventId = 'evt_invoice_succeeded_no_owner'
    const invoice = { id: 'in_7', subscription: 'sub_missing', customer: 'cus_missing', status: 'paid' }
    const stripeEvent = buildStripeEvent('invoice.payment_succeeded', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1, eventType: 'invoice.payment_succeeded' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('H: invoice.payment_succeeded without a subscriptionId skips the transaction entirely', async () => {
    const eventId = 'evt_invoice_succeeded_no_sub'
    const invoice = { id: 'in_8', subscription: null, customer: 'cus_1', status: 'paid' }
    const stripeEvent = buildStripeEvent('invoice.payment_succeeded', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1, eventType: 'invoice.payment_succeeded' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('I: the payment-failed email fires only after the transaction has committed', async () => {
    const eventId = 'evt_invoice_failed_email_order'
    const invoice = { id: 'in_9', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedStatusWhenEmailSent = null
    sendProfessionalPaymentFailedEmail.mockImplementation(async () => {
      // Reads the ROOT store (not a transaction snapshot) — only reflects a
      // committed transaction.
      const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
      committedStatusWhenEmailSent = owner.subscriptionStatus
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendProfessionalPaymentFailedEmail).toHaveBeenCalledTimes(1)
    expect(committedStatusWhenEmailSent).toBe('past_due')
  })

  it('J: markStripeWebhookEventProcessed runs exactly once, from inside the transaction — the wrapper never calls it again', async () => {
    const eventId = 'evt_invoice_failed_no_double_finalize'
    const invoice = { id: 'in_10', subscription: 'sub_1', customer: 'cus_1', status: 'open' }
    const stripeEvent = buildStripeEvent('invoice.payment_failed', invoice, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, attempt: 1 })
    )
    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })
})
