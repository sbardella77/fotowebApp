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
// the atomic subscription handlers do with a *given* claimed attempt, not
// about the claim/lease mechanism itself (already covered exhaustively in
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
import { sendProfessionalCancellationScheduledEmail } from '@/lib/server/billing-emails'
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
  return { id: id || `evt_atomic_${eventIdSeq}`, type, data: { object } }
}

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

function seedReceipt({ eventId, status, attempts, eventType = 'customer.subscription.updated' }) {
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

describe('STEP 4.3: atomic finalization for customer.subscription.updated/deleted', () => {
  it('A: subscription.updated commits the owner write and the receipt PROCESSED together', async () => {
    const eventId = 'evt_sub_updated_success'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: 1700000000,
    }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'free', stripeSubscriptionId: 'sub_1', subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('professional')
    expect(owner.subscriptionStatus).toBe('active')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')
    expect(receipt.attempts).toBe(1)

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('B: subscription.deleted commits the owner downgrade and the receipt PROCESSED together', async () => {
    const eventId = 'evt_sub_deleted_success'
    const stripeEvent = buildStripeEvent('customer.subscription.deleted', { id: 'sub_1' }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active', subscriptionCancelAtPeriodEnd: false }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1, eventType: 'customer.subscription.deleted' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.received).toBe(true)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('free')
    expect(owner.subscriptionStatus).toBe('canceled')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSED')

    expect(markStripeWebhookEventProcessed).toHaveBeenCalledTimes(1)
  })

  it('C: subscription.updated rolls back the owner write when markProcessed hits fencing', async () => {
    const eventId = 'evt_sub_updated_fencing'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }, eventId)
    mockConstructEvent(stripeEvent)
    // This worker believes it holds attempt=1...
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'free', stripeSubscriptionId: 'sub_1' }],
      // ...but the receipt already shows attempts=2: another worker reclaimed
      // this delivery's stale lease before this worker reached finalization.
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('free')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('D: subscription.deleted rolls back the owner write when markProcessed hits fencing', async () => {
    const eventId = 'evt_sub_deleted_fencing'
    const stripeEvent = buildStripeEvent('customer.subscription.deleted', { id: 'sub_1' }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 2, eventType: 'customer.subscription.deleted' })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await POST(createWebhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.code).toBe('webhook_processing_in_progress')

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.plan).toBe('professional')
    expect(owner.subscriptionStatus).toBe('active')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)

    expect(markStripeWebhookEventFailed).not.toHaveBeenCalled()
  })

  it('E: a generic write failure inside the transaction rolls back and marks the receipt FAILED', async () => {
    const eventId = 'evt_sub_updated_generic_fail'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'free', stripeSubscriptionId: 'sub_1' }],
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
    expect(owner.plan).toBe('free')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } })
    expect(receipt.status).toBe('FAILED')

    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()
  })

  it('F: subscription.updated with no matching owner skips the transaction entirely (legacy standalone finalization)', async () => {
    const eventId = 'evt_sub_updated_no_owner'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_missing', status: 'active' }, eventId)
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

  it('F2: subscription.deleted with no matching owner skips the transaction entirely (legacy standalone finalization)', async () => {
    const eventId = 'evt_sub_deleted_no_owner'
    const stripeEvent = buildStripeEvent('customer.subscription.deleted', { id: 'sub_missing' }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1, eventType: 'customer.subscription.deleted' })],
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

  it('G: the cancellation email fires only after the transaction has committed', async () => {
    const eventId = 'evt_sub_updated_email_order'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', {
      id: 'sub_1', status: 'active', cancel_at_period_end: true, current_period_end: 1700000000,
    }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'professional', stripeSubscriptionId: 'sub_1', subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null }],
      stripeWebhookEvent: [seedReceipt({ eventId, status: 'PROCESSING', attempts: 1 })],
    })
    getPrismaClient.mockResolvedValue(prisma)

    let committedCancelFlagWhenEmailSent = null
    sendProfessionalCancellationScheduledEmail.mockImplementation(async () => {
      // Reads the ROOT store (not a transaction snapshot) — only reflects a
      // committed transaction. If this ran before commit, it would still see false.
      const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
      committedCancelFlagWhenEmailSent = owner.subscriptionCancelAtPeriodEnd
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendProfessionalCancellationScheduledEmail).toHaveBeenCalledTimes(1)
    expect(committedCancelFlagWhenEmailSent).toBe(true)
  })

  it('H: markStripeWebhookEventProcessed runs exactly once, from inside the transaction — the wrapper never calls it again', async () => {
    const eventId = 'evt_sub_updated_no_double_finalize'
    const stripeEvent = buildStripeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }, eventId)
    mockConstructEvent(stripeEvent)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const prisma = createFakeTransactionalPrisma({
      owner: [{ id: 'owner-1', email: 'o@example.com', plan: 'free', stripeSubscriptionId: 'sub_1' }],
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
