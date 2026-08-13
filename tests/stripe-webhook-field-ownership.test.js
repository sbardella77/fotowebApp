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
// the atomic handlers actually write to the Owner row, not about the
// claim/lease mechanism itself (covered in tests/stripe-webhook-receipt.test.js).
// markStripeWebhookEventProcessed/Failed keep their real implementation so
// fencing/finalization run for real against the fake transactional store.
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
import { claimStripeWebhookEvent, markStripeWebhookEventProcessed } from '@/lib/server/stripe-webhook-receipt'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'
import { isEffectivePremiumActive } from '@/lib/event-access'

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
  return { id: id || `evt_ownership_${eventIdSeq}`, type, data: { object } }
}

function mockConstructEvent(event) {
  getStripe.mockReturnValue({ webhooks: { constructEvent: vi.fn(() => event) } })
}

function seedReceipt({ eventId, status, attempts, eventType }) {
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

function dateDaysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

async function post({ eventType, object, eventId, owner }) {
  const stripeEvent = buildStripeEvent(eventType, object, eventId)
  mockConstructEvent(stripeEvent)
  claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

  const prisma = createFakeTransactionalPrisma({
    owner: [owner],
    stripeWebhookEvent: [seedReceipt({ eventId: stripeEvent.id, status: 'PROCESSING', attempts: 1, eventType })],
  })
  getPrismaClient.mockResolvedValue(prisma)

  const response = await POST(createWebhookRequest())
  const updatedOwner = await prisma.owner.findUnique({ where: { id: owner.id } })
  return { response, updatedOwner }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// STEP 5.2: strict billing field ownership.
//
// SUBSCRIPTION DOMAIN owns: plan, subscriptionStatus, stripeSubscriptionId,
// subscriptionBillingInterval, subscriptionCurrentPeriodEnd,
// subscriptionCancelAtPeriodEnd, subscriptionCancelScheduledAt,
// subscriptionCanceledAt, subscriptionGraceUntil, planUpdatedAt.
//
// INVOICE DOMAIN owns: lastInvoiceId, lastInvoiceStatus, paymentFailedAt,
// lastPaymentError.
//
// These tests exercise the real POST handler end-to-end (not just the pure
// build* helpers) to demonstrate that invoice events can no longer touch
// subscription-domain fields, and that subscription events keep managing
// their own fields — including subscriptionGraceUntil — correctly on their
// own, without any dependency on invoice events.
describe('STEP 5.2: strict billing field ownership', () => {
  it('A: invoice.payment_succeeded (stale) cannot activate plan, change subscriptionStatus, or zero grace/canceledAt', async () => {
    const grace = dateDaysFromNow(3)
    const canceledAt = dateDaysFromNow(-30)
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'free',
      subscriptionStatus: 'past_due',
      subscriptionGraceUntil: grace,
      subscriptionCanceledAt: canceledAt,
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      lastInvoiceId: 'in_old',
      lastInvoiceStatus: 'open',
      paymentFailedAt: new Date(),
    }
    const invoice = { id: 'in_new', subscription: 'sub_1', customer: 'cus_1', status: 'paid' }

    const { response, updatedOwner } = await post({ eventType: 'invoice.payment_succeeded', object: invoice, owner })

    expect(response.status).toBe(200)
    // Subscription-domain fields: untouched by this invoice event.
    expect(updatedOwner.plan).toBe('free')
    expect(updatedOwner.subscriptionStatus).toBe('past_due')
    expect(updatedOwner.subscriptionGraceUntil).toEqual(grace)
    expect(updatedOwner.subscriptionCanceledAt).toEqual(canceledAt)
    // Invoice-domain fields: still updated as expected.
    expect(updatedOwner.paymentFailedAt).toBeNull()
    expect(updatedOwner.lastInvoiceId).toBe('in_new')
    expect(updatedOwner.lastInvoiceStatus).toBe('paid')
  })

  it('B: invoice.payment_failed cannot set subscriptionStatus=past_due or create/modify subscriptionGraceUntil', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'active',
      subscriptionGraceUntil: null,
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      lastInvoiceId: null,
      paymentFailedAt: null,
    }
    const invoice = { id: 'in_1', subscription: 'sub_1', customer: 'cus_1', status: 'open' }

    const { response, updatedOwner } = await post({ eventType: 'invoice.payment_failed', object: invoice, owner })

    expect(response.status).toBe(200)
    // Subscription-domain fields: untouched by this invoice event.
    expect(updatedOwner.subscriptionStatus).toBe('active')
    expect(updatedOwner.subscriptionGraceUntil).toBeNull()
  })

  it('C: subscription.updated past_due continues to initialize grace correctly', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'active',
      subscriptionGraceUntil: null,
      stripeSubscriptionId: 'sub_1',
    }
    const subscription = { id: 'sub_1', status: 'past_due' }

    const { response, updatedOwner } = await post({ eventType: 'customer.subscription.updated', object: subscription, owner })

    expect(response.status).toBe(200)
    expect(updatedOwner.subscriptionStatus).toBe('past_due')
    expect(updatedOwner.subscriptionGraceUntil).toBeInstanceOf(Date)
    expect(updatedOwner.subscriptionGraceUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('D: subscription.updated active continues to zero grace', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'past_due',
      subscriptionGraceUntil: dateDaysFromNow(3),
      subscriptionCancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_1',
    }
    const subscription = {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
    }

    const { response, updatedOwner } = await post({ eventType: 'customer.subscription.updated', object: subscription, owner })

    expect(response.status).toBe(200)
    expect(updatedOwner.subscriptionStatus).toBe('active')
    expect(updatedOwner.subscriptionGraceUntil).toBeNull()
  })

  it('E: subscription.deleted continues to downgrade to free/canceled with grace null', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'past_due',
      subscriptionGraceUntil: dateDaysFromNow(3),
      subscriptionCancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_1',
    }
    const subscription = { id: 'sub_1' }

    const { response, updatedOwner } = await post({ eventType: 'customer.subscription.deleted', object: subscription, owner })

    expect(response.status).toBe(200)
    expect(updatedOwner.plan).toBe('free')
    expect(updatedOwner.subscriptionStatus).toBe('canceled')
    expect(updatedOwner.subscriptionGraceUntil).toBeNull()
    expect(updatedOwner.stripeSubscriptionId).toBeNull()
  })

  it('F: invoice.payment_failed continues to update paymentFailedAt, lastInvoiceId/status, lastPaymentError', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      lastInvoiceId: null,
      lastInvoiceStatus: null,
      paymentFailedAt: null,
      lastPaymentError: null,
    }
    const invoice = {
      id: 'in_1',
      subscription: 'sub_1',
      customer: 'cus_1',
      status: 'open',
      payment_intent: { last_payment_error: { message: 'Your card was declined.' } },
    }

    const { response, updatedOwner } = await post({ eventType: 'invoice.payment_failed', object: invoice, owner })

    expect(response.status).toBe(200)
    expect(updatedOwner.paymentFailedAt).toBeInstanceOf(Date)
    expect(updatedOwner.lastInvoiceId).toBe('in_1')
    expect(updatedOwner.lastInvoiceStatus).toBe('open')
    expect(updatedOwner.lastPaymentError).toBe('Your card was declined.')
  })

  it('G: invoice.payment_succeeded continues to zero paymentFailedAt/lastPaymentError and update lastInvoiceId/status', async () => {
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'past_due',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      lastInvoiceId: 'in_old',
      lastInvoiceStatus: 'open',
      paymentFailedAt: new Date(),
      lastPaymentError: 'Your card was declined.',
    }
    const invoice = { id: 'in_new', subscription: 'sub_1', customer: 'cus_1', status: 'paid' }

    const { response, updatedOwner } = await post({ eventType: 'invoice.payment_succeeded', object: invoice, owner })

    expect(response.status).toBe(200)
    expect(updatedOwner.paymentFailedAt).toBeNull()
    expect(updatedOwner.lastPaymentError).toBeNull()
    expect(updatedOwner.lastInvoiceId).toBe('in_new')
    expect(updatedOwner.lastInvoiceStatus).toBe('paid')
  })

  it('regression: a stale invoice.payment_succeeded no longer revokes access for an owner legitimately in grace', async () => {
    // This is the exact scenario from the STEP 5.1b residual-bug audit:
    // a newer customer.subscription.updated already set a valid future
    // subscriptionGraceUntil; an older/stale invoice.payment_succeeded then
    // arrives. Before STEP 5.2, invoice.payment_succeeded unconditionally
    // zeroed subscriptionGraceUntil, causing isEffectivePremiumActive to flip
    // from true to false — an unauthorized access revocation. After STEP 5.2,
    // invoice never touches subscriptionGraceUntil, so access must stay true.
    const grace = dateDaysFromNow(3)
    const owner = {
      id: 'owner-1',
      email: 'o@example.com',
      plan: 'professional',
      subscriptionStatus: 'past_due',
      subscriptionGraceUntil: grace,
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      lastInvoiceId: 'in_old',
      paymentFailedAt: new Date(),
    }

    expect(isEffectivePremiumActive(owner)).toBe(true)

    const invoice = { id: 'in_stale', subscription: 'sub_1', customer: 'cus_1', status: 'paid' }
    const { response, updatedOwner } = await post({ eventType: 'invoice.payment_succeeded', object: invoice, owner })

    expect(response.status).toBe(200)
    expect(isEffectivePremiumActive(updatedOwner)).toBe(true)
  })
})
