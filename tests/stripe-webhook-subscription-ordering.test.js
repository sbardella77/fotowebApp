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
    bootstrapStripeSubscriptionOrdering: vi.fn(actual.bootstrapStripeSubscriptionOrdering),
  }
})

import { POST } from '@/app/api/stripe/webhook/route'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  sendProfessionalCanceledEmail,
  sendProfessionalCancellationScheduledEmail,
} from '@/lib/server/billing-emails'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  markStripeWebhookEventFailed,
} from '@/lib/server/stripe-webhook-receipt'
import { bootstrapStripeSubscriptionOrdering } from '@/lib/server/stripe-billing-ordering'
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
  return { id: id || `evt_sub_ord_${eventIdSeq}`, type, created, data: { object } }
}

function buildSubscriptionPayload({
  id = 'sub_1', status = 'active', cancelAtPeriodEnd = false, currentPeriodEnd,
  metadata,
} = {}) {
  return { id, status, cancel_at_period_end: cancelAtPeriodEnd, current_period_end: currentPeriodEnd, metadata }
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
        return subscriptionsRetrieveImpl ? subscriptionsRetrieveImpl(...args) : { id: args[0], status: 'active' }
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
    stripeSubscriptionId: 'sub_1',
    subscriptionCancelAtPeriodEnd: false,
    subscriptionCurrentPeriodEnd: null,
    stripeBillingCursorSubscriptionId: 'sub_1',
    lastStripeSubscriptionEventCreated: 1000n,
    lastStripeInvoiceEventCreated: null,
    lastInvoiceId: null,
    lastInvoiceStatus: null,
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

function mockConstructEvent(event, stripe) {
  getStripe.mockReturnValue(stripe || buildMockStripe({ event }))
}

describe('STEP 5.7: flag OFF — legacy behavior invariance', () => {
  it('A: updated — legacy path runs unchanged, no ordering calls', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 999999 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.subscriptionStatus).toBe('past_due')
    // No ordering machinery touched at all.
    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(stripe.events.list).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(bootstrapStripeSubscriptionOrdering).not.toHaveBeenCalled()
    // Legacy never touches the cursor fields.
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
    expect(row.lastStripeSubscriptionEventCreated).toBeNull()
  })

  it('B: deleted — legacy path runs unchanged, no ordering calls', async () => {
    const subscription = buildSubscriptionPayload()
    const event = buildStripeEvent('customer.subscription.deleted', subscription, { created: 999999 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.stripeSubscriptionId).toBeNull()
    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(bootstrapStripeSubscriptionOrdering).not.toHaveBeenCalled()
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
  })
})

describe('STEP 5.7: flag ON — bootstrap on null marker', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('C: updated with null marker bootstraps via the helper, receipt PROCESSED, zero email', async () => {
    const subscription = buildSubscriptionPayload({ status: 'active' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', status: 'active', cancel_at_period_end: false }),
    })
    const owner = seedOwner({ plan: 'free', subscriptionStatus: null, stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1500n)
    expect(row.plan).toBe('professional')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')

    expect(sendProfessionalCancellationScheduledEmail).not.toHaveBeenCalled()
    expect(sendProfessionalCanceledEmail).not.toHaveBeenCalled()
    expect(trackServerEvent).not.toHaveBeenCalled()
  })

  it('D: deleted with null marker bootstraps and preserves the tombstone scope', async () => {
    const subscription = buildSubscriptionPayload()
    const event = buildStripeEvent('customer.subscription.deleted', subscription, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', status: 'canceled' }),
    })
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.stripeSubscriptionId).toBeNull()
    // Tombstone: scope stays, even though the bootstrap helper's canonical
    // write nulled stripeSubscriptionId.
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1500n)
    expect(sendProfessionalCanceledEmail).not.toHaveBeenCalled()
  })
})

describe('STEP 5.7: flag ON — recency (stale / newer / same-second)', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('E: stale updated — incoming < cursor, zero business write, receipt PROCESSED', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 500 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.subscriptionStatus).toBe('active')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1000n)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')

    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(stripe.events.retrieve).not.toHaveBeenCalled()
  })

  it('F: stale deleted — does not cancel a state that is already newer', async () => {
    const subscription = buildSubscriptionPayload()
    const event = buildStripeEvent('customer.subscription.deleted', subscription, { created: 500 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ plan: 'professional', subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('professional')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.stripeSubscriptionId).toBe('sub_1')
  })

  it('G: newer updated — business state + cursor + receipt commit atomically, no retrieve needed', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.subscriptionStatus).toBe('past_due')
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(2000n)
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('H: newer deleted — stripeSubscriptionId null, scope preserved, cursor advanced', async () => {
    const subscription = buildSubscriptionPayload()
    const event = buildStripeEvent('customer.subscription.deleted', subscription, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(2000n)
  })

  it('I: updated with status=canceled follows the same tombstone invariant', async () => {
    const subscription = buildSubscriptionPayload({ status: 'canceled' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeSubscriptionId).toBeNull()
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(2000n)
  })

  it('J: same-second — canonical retrieve is used as authority, zero email', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', status: 'active', cancel_at_period_end: false }),
    })
    const owner = seedOwner({ subscriptionStatus: 'past_due', lastStripeSubscriptionEventCreated: 1000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Canonical retrieve says active — that wins over the incoming past_due payload.
    expect(row.subscriptionStatus).toBe('active')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1000n)
    expect(sendProfessionalCancellationScheduledEmail).not.toHaveBeenCalled()
    expect(sendProfessionalCanceledEmail).not.toHaveBeenCalled()
  })

  it('K: event.id lexical order is never consulted for same-second resolution', async () => {
    // "evt_AAA" sorts before "evt_zzz" lexically — if id were ever used as a
    // tie-break this would resolve the wrong way. The outcome must only
    // depend on the canonical retrieve.
    const subscription = buildSubscriptionPayload({ status: 'active' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { id: 'evt_AAA_lexically_first', created: 1000 })
    const stripe = buildMockStripe({
      event,
      subscriptionsRetrieveImpl: () => ({ id: 'sub_1', status: 'past_due' }),
    })
    const owner = seedOwner({ subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 1000n })

    const { prisma } = await run({ event, owner, stripe })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Canonical retrieve (past_due) wins, regardless of the trigger event's
    // own lexically-first id and regardless of its own payload (active).
    expect(row.subscriptionStatus).toBe('past_due')
  })
})

describe('STEP 5.7: flag ON — identity classification', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('L: an event for an old, already-superseded subscription is a stale no-op (PROCESSED)', async () => {
    const subscription = buildSubscriptionPayload({ id: 'sub_A_old', status: 'active' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 1000 })
    const stripe = buildMockStripe({ event })
    // Owner has already moved on to sub_B — sub_A_old is no longer scoped
    // anywhere on this owner.
    const owner = seedOwner({ stripeSubscriptionId: 'sub_B', stripeBillingCursorSubscriptionId: 'sub_B', lastStripeSubscriptionEventCreated: 5000n })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeSubscriptionId).toBe('sub_B')
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_B')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('M: metadata.ownerId match with a not-yet-linked owner is a retryable race, receipt NOT processed', async () => {
    const subscription = buildSubscriptionPayload({ id: 'sub_NEW', status: 'active', metadata: { ownerId: 'owner-1' } })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 1000 })
    const stripe = buildMockStripe({ event })
    // Brand-new owner, no subscription linked yet (checkout.session.completed
    // for this subscription hasn't been processed by this worker yet).
    const owner = seedOwner({ stripeSubscriptionId: null, stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(503)
    expect(markStripeWebhookEventFailed).toHaveBeenCalledTimes(1)
    expect(markStripeWebhookEventProcessed).not.toHaveBeenCalled()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('FAILED')

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeSubscriptionId).toBeNull()
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
  })
})

describe('STEP 5.7: flag ON — CAS race, fencing, bootstrap failure, refresh', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('N (item 14): a worker whose CAS attempt loses to a concurrently-committed newer write becomes stale, never overwrites it', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 200 }) // event A
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 100n })

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
        row.lastStripeSubscriptionEventCreated = 300n
        row.subscriptionStatus = 'canceled'
      }
      return realTransaction(fn)
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // B's state must survive; A (older, now-stale) must not overwrite it.
    expect(row.lastStripeSubscriptionEventCreated).toBe(300n)
    expect(row.subscriptionStatus).toBe('canceled')
  })

  it('O: fencing rollback leaves cursor and business state untouched', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 2000 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 1000n })

    // Receipt already shows attempts=2: another worker reclaimed this
    // delivery's stale lease first. We believe we hold attempt=1.
    const { response, prisma } = await run({ event, owner, stripe, receiptAttempts: 2 })

    expect(response.status).toBe(503)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.subscriptionStatus).toBe('active')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1000n)
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
  })

  it('P: bootstrap helper failure returns non-2xx with no partial write', async () => {
    const subscription = buildSubscriptionPayload({ status: 'active' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 1500 })
    const stripe = buildMockStripe({
      event,
      eventsRetrieve: vi.fn().mockRejectedValue(new Error('No such event')),
    })
    const owner = seedOwner({ plan: 'free', stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const { response, prisma } = await run({ event, owner, stripe })

    expect(response.status).toBe(500)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: event.id } })
    expect(receipt.status).toBe('FAILED')
  })

  it('Q: ALREADY_BOOTSTRAPPED refreshes the owner snapshot and continues on the fresh marker', async () => {
    const subscription = buildSubscriptionPayload({ status: 'past_due' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 600 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ subscriptionStatus: 'active', stripeBillingCursorSubscriptionId: null, lastStripeSubscriptionEventCreated: null })

    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: event.id, eventType: event.type })],
    })
    mockConstructEvent(event, stripe)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })
    getPrismaClient.mockResolvedValue(prisma)

    bootstrapStripeSubscriptionOrdering.mockImplementationOnce(async ({ owner: ownerArg }) => {
      // Simulate a concurrent worker's own bootstrap having already
      // committed scope + marker for this owner.
      const row = prisma.owner._rows.find((r) => r.id === ownerArg.id)
      row.stripeBillingCursorSubscriptionId = 'sub_1'
      row.lastStripeSubscriptionEventCreated = 500n
      return { action: 'ALREADY_BOOTSTRAPPED' }
    })

    const response = await POST(createWebhookRequest())

    expect(response.status).toBe(200)
    expect(bootstrapStripeSubscriptionOrdering).toHaveBeenCalledTimes(1)
    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Advanced via the ordinary CAS path from the refreshed 500n baseline —
    // proves the handler used fresh data, not its original null snapshot.
    expect(row.lastStripeSubscriptionEventCreated).toBe(600n)
    expect(row.subscriptionStatus).toBe('past_due')
  })
})

describe('STEP 5.7: flag ON — side effects', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('R: the stale path fires zero email and zero PostHog', async () => {
    const subscription = buildSubscriptionPayload({ status: 'canceled' })
    const event = buildStripeEvent('customer.subscription.updated', subscription, { created: 500 })
    const stripe = buildMockStripe({ event })
    const owner = seedOwner({ lastStripeSubscriptionEventCreated: 1000n })

    await run({ event, owner, stripe })

    expect(sendProfessionalCancellationScheduledEmail).not.toHaveBeenCalled()
    expect(sendProfessionalCanceledEmail).not.toHaveBeenCalled()
    expect(trackServerEvent).not.toHaveBeenCalled()
  })

  it('S: the newer normal path still fires the existing legacy emails post-commit', async () => {
    const subscription = buildSubscriptionPayload({
      status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: 1700000000,
    })
    const updatedEvent = buildStripeEvent('customer.subscription.updated', subscription, { created: 2000 })
    const stripeUpdated = buildMockStripe({ event: updatedEvent })
    const ownerForUpdate = seedOwner({ subscriptionCancelAtPeriodEnd: false, lastStripeSubscriptionEventCreated: 1000n })

    await run({ event: updatedEvent, owner: ownerForUpdate, stripe: stripeUpdated })
    expect(sendProfessionalCancellationScheduledEmail).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'

    const deletedSubscription = buildSubscriptionPayload()
    const deletedEvent = buildStripeEvent('customer.subscription.deleted', deletedSubscription, { created: 2000 })
    const stripeDeleted = buildMockStripe({ event: deletedEvent })
    const ownerForDelete = seedOwner({ subscriptionStatus: 'active', subscriptionCancelAtPeriodEnd: false, lastStripeSubscriptionEventCreated: 1000n })

    await run({ event: deletedEvent, owner: ownerForDelete, stripe: stripeDeleted })
    expect(sendProfessionalCanceledEmail).toHaveBeenCalledTimes(1)
  })
})

describe('STEP 5.7 (item 15): deleted then an older updated must not reactivate professional', () => {
  beforeEach(() => {
    process.env.STRIPE_ORDERING_GUARD_ENABLED = 'true'
  })

  it('T: an older updated arriving after a newer deleted stays a stale no-op', async () => {
    const deletedSubscription = buildSubscriptionPayload({ status: 'canceled' })
    const deletedEvent = buildStripeEvent('customer.subscription.deleted', deletedSubscription, { created: 300 })
    const stripeForDeleted = buildMockStripe({ event: deletedEvent })
    const owner = seedOwner({ plan: 'professional', subscriptionStatus: 'active', lastStripeSubscriptionEventCreated: 100n })

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
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(300n)

    // Now an OLD updated (created=200, between the original 100n baseline
    // and the deleted's 300n) arrives late for the same, now-tombstoned
    // subscription.
    const oldUpdatedSubscription = buildSubscriptionPayload({ status: 'past_due' })
    const oldUpdatedEvent = buildStripeEvent('customer.subscription.updated', oldUpdatedSubscription, { created: 200 })
    const stripeForOldUpdate = buildMockStripe({ event: oldUpdatedEvent })

    prisma.stripeWebhookEvent._rows.push(seedReceipt({ eventId: oldUpdatedEvent.id, eventType: oldUpdatedEvent.type }))
    mockConstructEvent(oldUpdatedEvent, stripeForOldUpdate)
    claimStripeWebhookEvent.mockResolvedValue({ action: 'PROCESS', receipt: { attempts: 1 } })

    const secondResponse = await POST(createWebhookRequest())
    expect(secondResponse.status).toBe(200)

    row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // Must NOT be reactivated.
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()

    const secondReceipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: oldUpdatedEvent.id } })
    expect(secondReceipt.status).toBe('PROCESSED')
  })
})
