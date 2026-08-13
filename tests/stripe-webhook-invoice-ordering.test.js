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
vi.mock('@/lib/server/stripe-webhook-receipt', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    claimStripeWebhookEvent: vi.fn(),
    markStripeWebhookEventProcessed: vi.fn(actual.markStripeWebhookEventProcessed),
    markStripeWebhookEventFailed: vi.fn(actual.markStripeWebhookEventFailed),
  }
})
vi.mock('@/lib/server/stripe-billing-ordering', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    bootstrapStripeInvoiceOrdering: vi.fn(actual.bootstrapStripeInvoiceOrdering),
  }
})

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  sendProfessionalPaymentFailedEmail,
  sendProfessionalPaymentRecoveredEmail,
} from '@/lib/server/billing-emails'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
} from '@/lib/server/stripe-webhook-receipt'
import { bootstrapStripeInvoiceOrdering } from '@/lib/server/stripe-billing-ordering'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, NODE_ENV: 'test', STRIPE_WEBHOOK_SECRET: 'whsec_test_secret' }
})

afterAll(() => {
  process.env = originalEnv
})

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.STRIPE_ORDERING_GUARD_ENABLED
})

function createWebhookRequest({ payload = '{}', signature = 'sig_test' } = {}) {
  return {
    text: vi.fn().mockResolvedValue(payload),
    headers: { get: vi.fn((name) => (name === 'stripe-signature' ? signature : null)) },
  }
}

let eventIdSeq = 0
function buildStripeEvent(type, object, { id, created = 1000 } = {}) {
  eventIdSeq += 1
  return { id: id || `evt_inv_ord_${eventIdSeq}`, type, created, data: { object } }
}

function buildInvoicePayload({
  id = 'in_1', subscription = 'sub_1', customer = 'cus_1', status = 'open', lastPaymentErrorMessage,
} = {}) {
  return {
    id, subscription, customer, status,
    payment_intent: lastPaymentErrorMessage ? { last_payment_error: { message: lastPaymentErrorMessage } } : undefined,
  }
}

function buildMockStripe({ event, eventsRetrieve, eventsListImpl, subscriptionsRetrieveImpl, callOrder } = {}) {
  return {
    webhooks: { constructEvent: vi.fn(() => event) },
    events: {
      retrieve: eventsRetrieve || vi.fn().mockResolvedValue({ id: event?.id }),
      list: vi.fn(async (params) => {
        callOrder?.push('events.list')
        return eventsListImpl ? eventsListImpl(params) : { data: [], has_more: false }
      }),
    },
    subscriptions: {
      retrieve: vi.fn(async (...args) => {
        callOrder?.push('subscriptions.retrieve')
        return subscriptionsRetrieveImpl
          ? subscriptionsRetrieveImpl(...args)
          : { id: args[0], latest_invoice: { id: 'in_latest', status: 'open' } }
      }),
    },
  }
}

function seedOwner(overrides = {}) {
  return {
    id: 'owner-1',
    email: 'owner@example.com',
    plan: 'professional',
    subscriptionStatus: 'active',
    subscriptionGraceUntil: null,
    subscriptionCanceledAt: null,
    stripeSubscriptionId: 'sub_1',
    stripeCustomerId: 'cus_1',
    stripeBillingCursorSubscriptionId: 'sub_1',
    lastStripeSubscriptionEventCreated: null,
    lastStripeInvoiceEventCreated: 1000n,
    lastInvoiceId: 'in_seed',
    lastInvoiceStatus: 'open',
    paymentFailedAt: null,
    lastPaymentError: null,
    ...overrides,
  }
}

function seedReceipt({ eventId, status = 'PROCESSING', attempts = 1, eventType }) {
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

function mockConstructEvent(event, stripe) {
  getStripe.mockReturnValue(stripe || buildMockStripe({ event }))
}

async function run({ event, owner, stripe, receiptAttempts = 1 }) {
  mockConstructEvent(event, stripe)
  claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
  const prisma = createFakeTransactionalPrisma({
    owner: [owner],
    stripeWebhookEvent: [seedReceipt({ eventId: event.id, attempts: receiptAttempts, eventType: event.type })],
  })
  getPrismaClient.mockResolvedValue(prisma)
  const response = await POST(createWebhookRequest())
  return { response, prisma }
}

describe('STEP 5.8: flag OFF — legacy behavior invariance', () => {
  it('A: payment_failed — legacy path runs unchanged, no ordering calls', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'open', lastPaymentErrorMessage: 'declined' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 999999 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null, paymentFailedAt: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeInstanceOf(Date)
    expect(row.lastInvoiceId).toBe('in_new')
    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(bootstrapStripeInvoiceOrdering).not.toHaveBeenCalled()
    expect(row.lastStripeInvoiceEventCreated).toBeNull()
  })

  it('B: payment_succeeded — legacy path runs unchanged, no ordering calls', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 999999 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null, paymentFailedAt: new Date() })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeNull()
    expect(row.lastInvoiceId).toBe('in_new')
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(bootstrapStripeInvoiceOrdering).not.toHaveBeenCalled()
    expect(row.lastStripeInvoiceEventCreated).toBeNull()
  })
})

describe('STEP 5.8: flag ON — bootstrap on null marker', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('C: payment_failed with null marker bootstraps via the helper, receipt PROCESSED, zero email', async () => {
    const invoice = buildInvoicePayload({ status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_boot', status: 'open' } }),
    })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeInvoiceEventCreated).toBe(1500n)
    expect(row.lastInvoiceId).toBe('in_boot')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
    expect(sendProfessionalPaymentFailedEmail).not.toHaveBeenCalled()
    expect(trackServerEvent).not.toHaveBeenCalled()
  })

  it('D: payment_succeeded with null marker bootstraps via the helper', async () => {
    const invoice = buildInvoicePayload({ status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_boot', status: 'paid' } }),
    })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null, paymentFailedAt: new Date() })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeInvoiceEventCreated).toBe(1500n)
    expect(row.paymentFailedAt).toBeNull()
    expect(sendProfessionalPaymentRecoveredEmail).not.toHaveBeenCalled()
  })
})

describe('STEP 5.8: flag ON — recency (stale / newer / same-second)', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('E: stale payment_failed — zero write', async () => {
    const invoice = buildInvoicePayload({ id: 'in_stale', status: 'open', lastPaymentErrorMessage: 'declined' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 500 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastInvoiceId).toBe('in_seed')
    expect(row.paymentFailedAt).toBeNull()
    expect(row.lastStripeInvoiceEventCreated).toBe(1000n)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('F: stale payment_succeeded — zero write', async () => {
    const invoice = buildInvoicePayload({ id: 'in_stale', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 500 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, paymentFailedAt: new Date() })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeInstanceOf(Date)
    expect(row.lastInvoiceId).toBe('in_seed')
  })

  it('G: newer payment_failed — invoice bookkeeping + cursor + receipt atomic, access fields untouched', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'open', lastPaymentErrorMessage: 'card declined' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, plan: 'professional', subscriptionStatus: 'active', subscriptionGraceUntil: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeInstanceOf(Date)
    expect(row.lastInvoiceId).toBe('in_new')
    expect(row.lastInvoiceStatus).toBe('open')
    expect(row.lastPaymentError).toBe('card declined')
    expect(row.lastStripeInvoiceEventCreated).toBe(2000n)
    // Access/lifecycle fields untouched (STEP 5.2 field ownership).
    expect(row.plan).toBe('professional')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.subscriptionGraceUntil).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('H: newer payment_succeeded — clears failure bookkeeping + cursor + receipt', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, paymentFailedAt: new Date(), lastPaymentError: 'card declined' })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeNull()
    expect(row.lastPaymentError).toBeNull()
    expect(row.lastInvoiceId).toBe('in_new')
    expect(row.lastInvoiceStatus).toBe('paid')
    expect(row.lastStripeInvoiceEventCreated).toBe(2000n)
  })
})

describe('STEP 5.8: flag ON — identity beats discovery-via-customerId', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('I: an old subscription found via customerId while scope points elsewhere is a no-op (PROCESSED)', async () => {
    const invoice = buildInvoicePayload({ id: 'in_old_sub', subscription: 'sub_A_old', customer: 'cus_1', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 999 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ stripeSubscriptionId: 'sub_B', stripeCustomerId: 'cus_1', stripeBillingCursorSubscriptionId: 'sub_B', lastStripeInvoiceEventCreated: 500n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastInvoiceId).toBe('in_seed')
    expect(row.lastStripeInvoiceEventCreated).toBe(500n)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('J: a trailing invoice for a canceled-tombstone subscription can only update invoice bookkeeping', async () => {
    const invoice = buildInvoicePayload({ id: 'in_trailing', subscription: 'sub_A', customer: 'cus_1', status: 'open', lastPaymentErrorMessage: 'declined' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 400 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({
      plan: 'free', subscriptionStatus: 'canceled', subscriptionCanceledAt: new Date('2026-01-01'),
      stripeSubscriptionId: null, stripeCustomerId: 'cus_1',
      stripeBillingCursorSubscriptionId: 'sub_A', lastStripeInvoiceEventCreated: 300n,
    })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Invoice bookkeeping updates.
    expect(row.lastInvoiceId).toBe('in_trailing')
    expect(row.paymentFailedAt).toBeInstanceOf(Date)
    expect(row.lastStripeInvoiceEventCreated).toBe(400n)
    // Access stays revoked — invoice can never reactivate it.
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()
  })

  it('K: a stale invoice for the previous subscription after a resubscribe is a no-op, bootstrap never attempted', async () => {
    const invoice = buildInvoicePayload({ id: 'in_A', subscription: 'sub_A', customer: 'cus_1', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 700 })
    const stripe = buildMockStripe({ event })
    // Owner already resubscribed to sub_B; invoice marker null (fresh checkout).
    const owner = seedOwner({ stripeSubscriptionId: 'sub_B', stripeCustomerId: 'cus_1', stripeBillingCursorSubscriptionId: 'sub_B', lastStripeInvoiceEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    expect(bootstrapStripeInvoiceOrdering).not.toHaveBeenCalled()
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastStripeInvoiceEventCreated).toBeNull()
    expect(row.lastInvoiceId).toBe('in_seed')
  })
})

describe('STEP 5.8: flag ON — same-second reconciliation', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('L: same-second calls subscriptions.retrieve(expand latest_invoice), zero email', async () => {
    const invoice = buildInvoicePayload({ id: 'in_incoming', status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_canonical', status: 'open' } }),
    })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1', { expand: ['latest_invoice'] })
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Canonical wins, not the incoming payload's own id.
    expect(row.lastInvoiceId).toBe('in_canonical')
    expect(row.lastStripeInvoiceEventCreated).toBe(1000n)
    expect(sendProfessionalPaymentFailedEmail).not.toHaveBeenCalled()
    expect(sendProfessionalPaymentRecoveredEmail).not.toHaveBeenCalled()
  })

  it('M: same-second non-paid preserves paymentFailedAt/lastPaymentError', async () => {
    const invoice = buildInvoicePayload({ status: 'paid' }) // incoming payload would clear, canonical must win instead
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_canonical', status: 'open' } }),
    })
    const existingFailedAt = new Date('2026-01-01')
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, paymentFailedAt: existingFailedAt, lastPaymentError: 'declined' })

    const { prisma } = await run({ event, owner, stripe })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toEqual(existingFailedAt)
    expect(row.lastPaymentError).toBe('declined')
  })

  it('N: same-second paid clears paymentFailedAt/lastPaymentError', async () => {
    const invoice = buildInvoicePayload({ status: 'open' }) // incoming would NOT clear, canonical must win instead
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_canonical', status: 'paid' } }),
    })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, paymentFailedAt: new Date(), lastPaymentError: 'declined' })

    const { prisma } = await run({ event, owner, stripe })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeNull()
    expect(row.lastPaymentError).toBeNull()
  })

  it('O: event.id lexical order is never consulted for same-second resolution', async () => {
    const invoice = buildInvoicePayload({ status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { id: 'evt_AAA_lexically_first', created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', latest_invoice: { id: 'in_canonical', status: 'open' } }),
    })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })

    const { prisma } = await run({ event, owner, stripe })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Canonical (open) wins regardless of the trigger's lexically-first id
    // and regardless of its own payload (paid).
    expect(row.lastInvoiceStatus).toBe('open')
  })
})

describe('STEP 5.8: flag ON — CAS race, fencing, bootstrap failure, refresh', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('P: a worker whose CAS attempt loses to a concurrently-committed newer write becomes stale, never overwrites it', async () => {
    const invoice = buildInvoicePayload({ id: 'in_A', status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 200 }) // event A
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 100n })

    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: event.id, eventType: event.type })],
    })
    mockConstructEvent(event, stripe)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(prisma)

    const realTransaction = prisma.$transaction
    let firstCall = true
    prisma.$transaction = vi.fn((fn) => {
      if (firstCall) {
        firstCall = false
        // Simulate event B (created=300) committing concurrently, between
        // event A's owner read and A's own CAS attempt.
        const row = prisma.owner._rows.find((r) => r.id === 'owner-1')
        row.lastStripeInvoiceEventCreated = 300n
        row.lastInvoiceId = 'in_B'
        row.paymentFailedAt = null
      }
      return realTransaction(fn)
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastStripeInvoiceEventCreated).toBe(300n)
    expect(row.lastInvoiceId).toBe('in_B')
    expect(row.paymentFailedAt).toBeNull()
  })

  it('Q: fencing rollback leaves cursor and invoice bookkeeping untouched', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe, receiptAttempts: 2 })

    expect(response.status).toBe(503)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastInvoiceId).toBe('in_seed')
    expect(row.lastStripeInvoiceEventCreated).toBe(1000n)
  })

  it('R: bootstrap helper failure returns non-2xx with no partial write', async () => {
    const invoice = buildInvoicePayload({ status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsRetrieve: vi.fn().mockRejectedValue(new Error('No such event')),
    })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(500)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
    expect(row.lastInvoiceId).toBe('in_seed')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('FAILED')
  })

  it('S: ALREADY_BOOTSTRAPPED refreshes the owner snapshot and continues on the fresh marker', async () => {
    const invoice = buildInvoicePayload({ id: 'in_new', status: 'open' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 600 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeInvoiceEventCreated: null })

    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: event.id, eventType: event.type })],
    })
    mockConstructEvent(event, stripe)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(prisma)

    bootstrapStripeInvoiceOrdering.mockImplementationOnce(async ({ owner: ownerArg }) => {
      const row = prisma.owner._rows.find((r) => r.id === ownerArg.id)
      row.stripeBillingCursorSubscriptionId = 'sub_1'
      row.lastStripeInvoiceEventCreated = 500n
      return { action: 'ALREADY_BOOTSTRAPPED' }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(bootstrapStripeInvoiceOrdering).toHaveBeenCalledTimes(1)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastStripeInvoiceEventCreated).toBe(600n)
    expect(row.lastInvoiceId).toBe('in_new')
  })
})

describe('STEP 5.8: flag ON — side effects', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('T: stale and scope-mismatch paths fire zero email and zero PostHog', async () => {
    const staleInvoice = buildInvoicePayload({ status: 'open' })
    const staleEvent = buildStripeEvent('invoice.payment_failed', staleInvoice, { created: 500 })
    const staleStripe = buildMockStripe({ event: staleEvent })
    const staleOwner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })
    await run({ event: staleEvent, owner: staleOwner, stripe: staleStripe })

    const mismatchInvoice = buildInvoicePayload({ subscription: 'sub_OTHER', customer: 'cus_1', status: 'paid' })
    const mismatchEvent = buildStripeEvent('invoice.payment_succeeded', mismatchInvoice, { created: 999 })
    const mismatchStripe = buildMockStripe({ event: mismatchEvent })
    const mismatchOwner = seedOwner({ stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_1', stripeBillingCursorSubscriptionId: 'sub_1' })
    await run({ event: mismatchEvent, owner: mismatchOwner, stripe: mismatchStripe })

    expect(sendProfessionalPaymentFailedEmail).not.toHaveBeenCalled()
    expect(sendProfessionalPaymentRecoveredEmail).not.toHaveBeenCalled()
    expect(trackServerEvent).not.toHaveBeenCalled()
  })

  it('U: the newer payment_failed path fires the legacy email post-commit', async () => {
    const invoice = buildInvoicePayload({ status: 'open', lastPaymentErrorMessage: 'declined' })
    const event = buildStripeEvent('invoice.payment_failed', invoice, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n })

    await run({ event, owner, stripe })

    expect(sendProfessionalPaymentFailedEmail).toHaveBeenCalledTimes(1)
    expect(sendProfessionalPaymentFailedEmail.mock.calls[0][0].owner.email).toBe('owner@example.com')
  })

  it('V: the newer payment_succeeded path fires the legacy recovered email post-commit when recoverable', async () => {
    const invoice = buildInvoicePayload({ status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeInvoiceEventCreated: 1000n, subscriptionStatus: 'past_due', paymentFailedAt: new Date() })

    await run({ event, owner, stripe })

    expect(sendProfessionalPaymentRecoveredEmail).toHaveBeenCalledTimes(1)
  })
})

describe('STEP 5.8 (item 19): identity always resolves before recency', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('a created=900 invoice for the wrong subscription must not overwrite anything, despite being numerically newer than cursor=500', async () => {
    const owner = seedOwner({
      stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_B', stripeBillingCursorSubscriptionId: 'sub_B',
      lastStripeInvoiceEventCreated: 500n, lastInvoiceId: 'in_B',
    })
    const invoice = buildInvoicePayload({ id: 'in_A_wrong', subscription: 'sub_A', customer: 'cus_1', status: 'paid' })
    const event = buildStripeEvent('invoice.payment_succeeded', invoice, { created: 900 })
    const stripe = buildMockStripe({ event })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Completely untouched — identity rejected this before recency was ever consulted.
    expect(row.lastInvoiceId).toBe('in_B')
    expect(row.lastStripeInvoiceEventCreated).toBe(500n)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
  })
})

describe('STEP 5.8 (item 20): deleted subscription then trailing invoice — access stays revoked', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('an invoice.payment_succeeded after subscription.deleted updates bookkeeping only, never reactivates access', async () => {
    // Step 1: subscription.deleted, created=300, via the real ordered
    // subscription handler (STEP 5.7).
    const deletedSubscription = { id: 'sub_A', status: 'canceled' }
    const deletedEvent = buildStripeEvent('customer.subscription.deleted', deletedSubscription, { created: 300 })
    const stripeForDeleted = buildMockStripe({ event: deletedEvent })
    const owner = seedOwner({
      stripeSubscriptionId: 'sub_A', stripeCustomerId: 'cus_1', stripeBillingCursorSubscriptionId: 'sub_A',
      lastStripeSubscriptionEventCreated: 100n, lastStripeInvoiceEventCreated: 100n,
      plan: 'professional', subscriptionStatus: 'active',
    })

    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: deletedEvent.id, eventType: deletedEvent.type })],
    })
    mockConstructEvent(deletedEvent, stripeForDeleted)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(prisma)

    const firstResponse = await POST(createWebhookRequest())
    expect(firstResponse.status).toBe(200)

    let row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_A')

    // Step 2: invoice.payment_succeeded, created=400, for the now-tombstoned sub_A.
    const trailingInvoice = buildInvoicePayload({ id: 'in_trailing', subscription: 'sub_A', customer: 'cus_1', status: 'paid' })
    const invoiceEvent = buildStripeEvent('invoice.payment_succeeded', trailingInvoice, { created: 400 })
    const stripeForInvoice = buildMockStripe({ event: invoiceEvent })

    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: invoiceEvent.id, eventType: invoiceEvent.type }))
    mockConstructEvent(invoiceEvent, stripeForInvoice)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const secondResponse = await POST(createWebhookRequest())
    expect(secondResponse.status).toBe(200)

    row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Invoice bookkeeping updated.
    expect(row.lastInvoiceId).toBe('in_trailing')
    expect(row.lastStripeInvoiceEventCreated).toBe(400n)
    // Access explicitly still revoked.
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()
  })
})
