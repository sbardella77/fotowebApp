import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  isStripeOrderingGuardEnabled,
  bootstrapStripeSubscriptionOrdering,
  bootstrapStripeInvoiceOrdering,
  StripeBillingScopeConflictError,
} from '@/lib/server/stripe-billing-ordering'
import { StripeWebhookFencingError } from '@/lib/server/stripe-webhook-receipt'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'

const originalEnv = process.env

beforeEach(() => {
  process.env = { ...originalEnv }
  delete process.env.STRIPE_ORDERING_GUARD_ENABLED
})

afterEach(() => {
  process.env = originalEnv
  vi.useRealTimers()
})

let eventIdSeq = 0
function buildTriggerEvent({ type, created, subscriptionId, id, invoiceId = 'in_trigger' }) {
  eventIdSeq += 1
  const isSubscriptionDomain = type.startsWith('customer.subscription')
  return {
    id: id || `evt_trigger_${eventIdSeq}`,
    type,
    created,
    data: {
      object: isSubscriptionDomain
        ? { id: subscriptionId, status: 'active' }
        : { id: invoiceId, subscription: subscriptionId },
    },
  }
}

function buildApiEvent({ id, type, created, subscriptionId, isInvoice = false }) {
  return {
    id,
    type,
    created,
    data: {
      object: isInvoice ? { id: `in_${id}`, subscription: subscriptionId } : { id: subscriptionId },
    },
  }
}

function buildMockStripe({ eventsRetrieve, eventsListImpl, subscriptionsRetrieve, callOrder } = {}) {
  const events = {
    retrieve: eventsRetrieve || vi.fn().mockResolvedValue({ id: 'evt_ok' }),
    list: vi.fn(async (params) => {
      callOrder?.push('events.list')
      return eventsListImpl ? eventsListImpl(params) : { data: [], has_more: false }
    }),
  }
  const subscriptions = {
    retrieve: vi.fn(async (...args) => {
      callOrder?.push('subscriptions.retrieve')
      return subscriptionsRetrieve ? subscriptionsRetrieve(...args) : { id: args[0], status: 'active' }
    }),
  }
  return { events, subscriptions }
}

function seedOwner(overrides = {}) {
  return {
    id: 'owner-1',
    email: 'owner@example.com',
    plan: 'free',
    subscriptionStatus: null,
    stripeSubscriptionId: null,
    stripeBillingCursorSubscriptionId: null,
    lastStripeSubscriptionEventCreated: null,
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

describe('isStripeOrderingGuardEnabled', () => {
  it('A: defaults to false when unset', () => {
    expect(isStripeOrderingGuardEnabled()).toBe(false)
  })

  it('B: true for "1"/"true"/"yes", case-insensitive; false for anything else', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'yEs']) {
      process.env.STRIPE_ORDERING_GUARD_ENABLED = truthy
      expect(isStripeOrderingGuardEnabled()).toBe(true)
    }
    for (const falsy of ['0', 'false', 'no', 'enabled', 'on', '', 'truex']) {
      process.env.STRIPE_ORDERING_GUARD_ENABLED = falsy
      expect(isStripeOrderingGuardEnabled()).toBe(false)
    }
  })
})

describe('bootstrapStripeSubscriptionOrdering — watermark discovery', () => {
  it('C: a local clock skewed far ahead does not influence the computed watermark', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))

    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1000 })
  })

  it('D: a local clock skewed far behind does not influence the computed watermark', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('1999-01-01T00:00:00Z'))

    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1000 })
  })

  it('E: watermark is the max event.created among matching events, not just the trigger', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({
        data: [
          buildApiEvent({ id: 'evt_a', type: 'customer.subscription.updated', created: 1200, subscriptionId: 'sub_1' }),
          buildApiEvent({ id: 'evt_b', type: 'customer.subscription.updated', created: 1100, subscriptionId: 'sub_1' }),
        ],
        has_more: false,
      }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1200 })
  })

  it('F: an event for a different subscription (even with a higher created) is ignored', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({
        data: [
          buildApiEvent({ id: 'evt_foreign', type: 'customer.subscription.updated', created: 9999, subscriptionId: 'sub_OTHER' }),
          buildApiEvent({ id: 'evt_mine', type: 'customer.subscription.updated', created: 1050, subscriptionId: 'sub_1' }),
        ],
        has_more: false,
      }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1050 })
  })

  it('G: paginates past >100 unrelated events to find a match on a later page', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const page1 = {
      data: Array.from({ length: 100 }, (_, i) =>
        buildApiEvent({ id: `evt_page1_${i}`, type: 'customer.subscription.updated', created: 2000 - i, subscriptionId: 'sub_OTHER' })
      ),
      has_more: true,
    }
    const page2 = {
      data: [buildApiEvent({ id: 'evt_page2_match', type: 'customer.subscription.updated', created: 1500, subscriptionId: 'sub_1' })],
      has_more: false,
    }
    let callIndex = 0
    const eventsListImpl = vi.fn(() => {
      const page = callIndex === 0 ? page1 : page2
      callIndex += 1
      return page
    })
    const stripe = buildMockStripe({ eventsListImpl })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(stripe.events.list).toHaveBeenCalledTimes(2)
    expect(stripe.events.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ starting_after: 'evt_page1_99' }))
    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1500 })
  })

  it('H: events.retrieve failure on the trigger propagates and writes nothing', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsRetrieve: vi.fn().mockRejectedValue(Object.assign(new Error('No such event'), { statusCode: 404 })),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await expect(
      bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })
    ).rejects.toThrow('No such event')

    expect(stripe.events.list).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
  })

  it('I / 20: events.list is always called before subscriptions.retrieve (LIST → RETRIEVE invariant)', async () => {
    const callOrder = []
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      callOrder,
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({ id: 'sub_1', status: 'active' }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(callOrder).toEqual(['events.list', 'subscriptions.retrieve'])
  })
})

describe('bootstrapStripeSubscriptionOrdering — business write', () => {
  it('J: writes subscription-domain fields + scope + subscription marker, leaves invoice fields/marker untouched', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: 1700000000,
        items: { data: [{ price: { recurring: { interval: 'month' } } }] },
      }),
    })
    const owner = seedOwner({
      plan: 'free',
      lastInvoiceId: 'in_untouched',
      lastInvoiceStatus: 'open',
      lastStripeInvoiceEventCreated: 999n,
    })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 1000 })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('professional')
    expect(row.subscriptionStatus).toBe('active')
    expect(row.subscriptionBillingInterval).toBe('monthly')
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1000n)
    // Invoice domain untouched.
    expect(row.lastInvoiceId).toBe('in_untouched')
    expect(row.lastInvoiceStatus).toBe('open')
    expect(row.lastStripeInvoiceEventCreated).toBe(999n)

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: trigger.id } })
    expect(receipt.status).toBe('PROCESSED')
  })

  it('canceled subscription retrieve yields tombstone-consistent state: stripeSubscriptionId null, scope preserved', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({ id: 'sub_1', status: 'canceled' }),
    })
    const owner = seedOwner({ plan: 'professional', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1' })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.plan).toBe('free')
    expect(row.subscriptionStatus).toBe('canceled')
    expect(row.stripeSubscriptionId).toBeNull()
    // Tombstone: scope stays pointing at the just-canceled subscription.
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeSubscriptionEventCreated).toBe(1000n)
  })
})

describe('bootstrapStripeInvoiceOrdering', () => {
  it('K: writes invoice-domain fields + scope + invoice marker, leaves access fields/subscription marker untouched', async () => {
    const trigger = buildTriggerEvent({ type: 'invoice.payment_succeeded', created: 2000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({
        id: 'sub_1',
        latest_invoice: { id: 'in_latest', status: 'paid' },
      }),
    })
    const owner = seedOwner({
      plan: 'professional',
      subscriptionStatus: 'past_due',
      subscriptionGraceUntil: new Date('2030-01-01'),
      subscriptionCanceledAt: null,
      lastStripeSubscriptionEventCreated: 888n,
    })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeInvoiceOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'BOOTSTRAPPED', watermark: 2000 })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.lastInvoiceId).toBe('in_latest')
    expect(row.lastInvoiceStatus).toBe('paid')
    expect(row.stripeBillingCursorSubscriptionId).toBe('sub_1')
    expect(row.lastStripeInvoiceEventCreated).toBe(2000n)
    // Access/lifecycle fields untouched.
    expect(row.plan).toBe('professional')
    expect(row.subscriptionStatus).toBe('past_due')
    expect(row.subscriptionGraceUntil).toEqual(new Date('2030-01-01'))
    // Subscription marker untouched.
    expect(row.lastStripeSubscriptionEventCreated).toBe(888n)
  })

  it('L: latest invoice paid clears paymentFailedAt/lastPaymentError', async () => {
    const trigger = buildTriggerEvent({ type: 'invoice.payment_succeeded', created: 2000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({ id: 'sub_1', latest_invoice: { id: 'in_latest', status: 'paid' } }),
    })
    const owner = seedOwner({ paymentFailedAt: new Date('2026-01-01'), lastPaymentError: 'card declined' })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await bootstrapStripeInvoiceOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toBeNull()
    expect(row.lastPaymentError).toBeNull()
  })

  it('M: latest invoice not paid preserves existing paymentFailedAt/lastPaymentError', async () => {
    const trigger = buildTriggerEvent({ type: 'invoice.payment_failed', created: 2000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({ id: 'sub_1', latest_invoice: { id: 'in_latest', status: 'open' } }),
    })
    const existingFailedAt = new Date('2026-01-01')
    const owner = seedOwner({ paymentFailedAt: existingFailedAt, lastPaymentError: 'card declined' })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await bootstrapStripeInvoiceOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.paymentFailedAt).toEqual(existingFailedAt)
    expect(row.lastPaymentError).toBe('card declined')
    // Bookkeeping id/status still update regardless.
    expect(row.lastInvoiceId).toBe('in_latest')
    expect(row.lastInvoiceStatus).toBe('open')
  })
})

describe('bootstrapStripe*Ordering — scope conflict, already-bootstrapped, fencing', () => {
  it('N: scope conflict throws StripeBillingScopeConflictError before any Stripe call, no write', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_B' })
    const stripe = buildMockStripe()
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: 'sub_A' })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    await expect(
      bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })
    ).rejects.toThrow(StripeBillingScopeConflictError)

    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(stripe.events.list).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('O: an already non-null domain marker returns ALREADY_BOOTSTRAPPED with zero Stripe calls and zero write', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe()
    const owner = seedOwner({ stripeBillingCursorSubscriptionId: 'sub_1', lastStripeSubscriptionEventCreated: 500n })
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type })],
    })

    const result = await bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })

    expect(result).toEqual({ action: 'ALREADY_BOOTSTRAPPED' })
    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(stripe.events.list).not.toHaveBeenCalled()
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('P: fencing rollback — a stale attempt rejects, and no partial bootstrap write survives', async () => {
    const trigger = buildTriggerEvent({ type: 'customer.subscription.updated', created: 1000, subscriptionId: 'sub_1' })
    const stripe = buildMockStripe({
      eventsListImpl: () => ({ data: [], has_more: false }),
      subscriptionsRetrieve: () => ({ id: 'sub_1', status: 'active' }),
    })
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({
      owner: [owner],
      // Receipt already shows attempts=2: another worker reclaimed this
      // delivery's stale lease first. Our caller believes it holds attempt=1.
      stripeWebhookEvent: [seedReceipt({ eventId: trigger.id, eventType: trigger.type, attempts: 2 })],
    })

    await expect(
      bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: trigger, attempt: 1 })
    ).rejects.toThrow(StripeWebhookFencingError)

    const row = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(row.stripeBillingCursorSubscriptionId).toBeNull()
    expect(row.lastStripeSubscriptionEventCreated).toBeNull()
    expect(row.plan).toBe('free')

    const receipt = await prisma.stripeWebhookEvent.findUnique({ where: { eventId: trigger.id } })
    expect(receipt.status).toBe('PROCESSING')
    expect(receipt.attempts).toBe(2)
  })

  it('R: an invalid trigger event throws before touching Stripe or the DB', async () => {
    const stripe = buildMockStripe()
    const owner = seedOwner()
    const prisma = createFakeTransactionalPrisma({ owner: [owner], stripeWebhookEvent: [] })

    await expect(
      bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent: { id: 'evt_x' }, attempt: 1 })
    ).rejects.toThrow(/stripeEvent\.created/)

    await expect(
      bootstrapStripeSubscriptionOrdering({
        stripe, prisma, owner,
        stripeEvent: { id: 'evt_x', created: 1000, type: 'invoice.payment_failed', data: { object: { id: 'sub_1' } } },
        attempt: 1,
      })
    ).rejects.toThrow(/unexpected event type/)

    await expect(
      bootstrapStripeSubscriptionOrdering({
        stripe, prisma, owner,
        stripeEvent: { id: 'evt_x', created: 1000, type: 'customer.subscription.updated', data: { object: {} } },
        attempt: 1,
      })
    ).rejects.toThrow(/could not resolve subscription id/)

    expect(stripe.events.retrieve).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('stripe-billing-ordering — zero side effects', () => {
  it('Q: the module imports nothing from billing-emails, track-server, or ops-alerts', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'lib/server/stripe-billing-ordering.js'),
      'utf8'
    )
    expect(source).not.toMatch(/billing-emails/)
    expect(source).not.toMatch(/track-server/)
    expect(source).not.toMatch(/ops-alerts/)
    expect(source).not.toMatch(/NextResponse/)
  })
})
