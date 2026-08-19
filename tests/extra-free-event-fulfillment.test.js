import { describe, it, expect, vi, beforeEach } from 'vitest'

// STEP: billing PR 1 — direct unit tests of the shared Extra Free Event
// fulfillment module, independent of the webhook route. These prove the
// module's own contract (lock/guard/commit, the optional
// finalizeInTransaction hook, no StripeWebhookEvent dependency when the
// hook is omitted) so a future reconciliation caller can rely on it without
// re-deriving these guarantees from route-level tests.

vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))
vi.mock('@/lib/analytics/track-server', () => ({ trackServerEvent: vi.fn() }))
vi.mock('@/lib/server/billing-emails', () => ({
  sendExtraFreeEventCreatedEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventFallbackCreditEmail: vi.fn().mockResolvedValue(undefined),
  sendExtraFreeEventCreditGrantedEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/prisma-gallery-repository', () => ({
  prismaGalleryRepository: { createEvent: vi.fn() },
}))

import {
  fulfillExtraFreeEventCreditCanonical,
  fulfillExtraFreeEventBuyAndCreate,
  expireExtraFreeEventCheckout,
} from '@/lib/server/extra-free-event-fulfillment'
import { StripeWebhookFencingError } from '@/lib/server/stripe-webhook-receipt'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
  sendExtraFreeEventCreditGrantedEmail,
} from '@/lib/server/billing-emails'
import { prismaGalleryRepository } from '@/lib/server/prisma-gallery-repository'
import { createFakeTransactionalPrisma } from './helpers/fake-prisma.js'

function seedOwner(overrides = {}) {
  return { id: 'owner-1', email: 'owner@example.com', extraEventCredits: 0, extraEventCheckoutSessionId: null, ...overrides }
}

function seedCheckout(overrides = {}) {
  return {
    id: 'checkout-1',
    ownerId: 'owner-1',
    stripeCheckoutSessionId: 'cs_test',
    eventName: 'Birthday Party',
    status: 'checkout_created',
    createdEventId: null,
    createdEventSlug: null,
    errorMessage: null,
    completedAt: null,
    autoCreatedAt: null,
    ...overrides,
  }
}

function makeSession(overrides = {}) {
  return { id: 'cs_test', customer: 'cus_test', metadata: {}, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fulfillExtraFreeEventCreditCanonical', () => {
  it('fulfills exactly once for a checkout_created row: credit incremented, status credit_granted, upsell recorded', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], extraFreeEventCheckout: [seedCheckout()] })
    const result = await fulfillExtraFreeEventCreditCanonical({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
    })

    expect(result).toMatchObject({ status: 'fulfilled', kind: 'credit_granted' })
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    expect(prisma.upsellEvent._rows).toHaveLength(1)
    expect(sendExtraFreeEventCreditGrantedEmail).toHaveBeenCalledTimes(1)
    expect(trackServerEvent).toHaveBeenCalled()
  })

  it.each(['auto_created', 'credit_granted', 'failed', 'expired'])(
    'merge-blocking: skips without a new grant when fresh status is already terminal (%s) — no downgrade',
    async (terminalStatus) => {
      const prisma = createFakeTransactionalPrisma({
        owner: [seedOwner({ extraEventCredits: 1 })],
        extraFreeEventCheckout: [seedCheckout({ status: terminalStatus })],
      })
      const result = await fulfillExtraFreeEventCreditCanonical({
        prisma,
        session: makeSession(),
        ownerId: 'owner-1',
        intent: 'extra_event',
        pendingCheckout: seedCheckout({ status: terminalStatus }),
      })

      expect(result).toEqual({ status: 'skipped', reason: `already_${terminalStatus}` })
      const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
      expect(owner.extraEventCredits).toBe(1)
      const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
      expect(checkout.status).toBe(terminalStatus)
      expect(sendExtraFreeEventCreditGrantedEmail).not.toHaveBeenCalled()
    },
  )

  it('works correctly with NO finalizeInTransaction hook — no StripeWebhookEvent dependency (future reconciliation contract)', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], extraFreeEventCheckout: [seedCheckout()] })
    const result = await fulfillExtraFreeEventCreditCanonical({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
      // finalizeInTransaction intentionally omitted.
    })
    expect(result.status).toBe('fulfilled')
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
  })

  it('calls finalizeInTransaction exactly once, inside the transaction, on the fulfilled branch', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], extraFreeEventCheckout: [seedCheckout()] })
    const finalizeInTransaction = vi.fn().mockResolvedValue(undefined)
    await fulfillExtraFreeEventCreditCanonical({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
      finalizeInTransaction,
    })
    expect(finalizeInTransaction).toHaveBeenCalledTimes(1)
  })

  it('calls finalizeInTransaction exactly once on the skipped branch too — a duplicate/retried delivery still finalizes its receipt', async () => {
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner({ extraEventCredits: 1 })],
      extraFreeEventCheckout: [seedCheckout({ status: 'credit_granted' })],
    })
    const finalizeInTransaction = vi.fn().mockResolvedValue(undefined)
    const result = await fulfillExtraFreeEventCreditCanonical({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout({ status: 'credit_granted' }),
      finalizeInTransaction,
    })
    expect(result.status).toBe('skipped')
    expect(finalizeInTransaction).toHaveBeenCalledTimes(1)
  })

  it('merge-blocking: a failing finalizeInTransaction rolls back the entire business mutation', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], extraFreeEventCheckout: [seedCheckout()] })
    const finalizeInTransaction = vi.fn().mockRejectedValue(new Error('receipt finalize blew up'))

    await expect(
      fulfillExtraFreeEventCreditCanonical({
        prisma,
        session: makeSession(),
        ownerId: 'owner-1',
        intent: 'extra_event',
        pendingCheckout: seedCheckout(),
        finalizeInTransaction,
      }),
    ).rejects.toThrow('receipt finalize blew up')

    // Nothing committed: the credit increment and status write are gone too.
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('checkout_created')
    expect(sendOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing:extra_free_event:credit_grant_failed' }))
  })

  it('re-throws StripeWebhookFencingError unchanged, without sending an ops alert', async () => {
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], extraFreeEventCheckout: [seedCheckout()] })
    const finalizeInTransaction = vi.fn().mockRejectedValue(new StripeWebhookFencingError('lost the lease'))

    await expect(
      fulfillExtraFreeEventCreditCanonical({
        prisma,
        session: makeSession(),
        ownerId: 'owner-1',
        intent: 'extra_event',
        pendingCheckout: seedCheckout(),
        finalizeInTransaction,
      }),
    ).rejects.toBeInstanceOf(StripeWebhookFencingError)

    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})

describe('fulfillExtraFreeEventBuyAndCreate', () => {
  it('primary success: Event created, checkout auto_created, no compensation credit', async () => {
    // Must genuinely insert into the passed tx (not just return a detached
    // object) — the code's own next step, tx.event.update(...), needs a
    // real row to find.
    prismaGalleryRepository.createEvent.mockImplementation(async ({ name, prismaClient }) =>
      prismaClient.event.create({ data: { id: 'event-1', slug: 'birthday-party', name } }),
    )
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], event: [], extraFreeEventCheckout: [seedCheckout()] })

    const result = await fulfillExtraFreeEventBuyAndCreate({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
    })

    expect(result).toMatchObject({ status: 'fulfilled', kind: 'auto_created' })
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('auto_created')
    expect(checkout.createdEventId).toBe('event-1')
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(sendExtraFreeEventCreatedEmail).toHaveBeenCalledTimes(1)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
  })

  it('compensation path: createEvent failure grants exactly one credit, marks failed, sends fallback email', async () => {
    prismaGalleryRepository.createEvent.mockRejectedValue(new Error('boom'))
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], event: [], extraFreeEventCheckout: [seedCheckout()] })

    const result = await fulfillExtraFreeEventBuyAndCreate({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
    })

    expect(result).toMatchObject({ status: 'fulfilled', kind: 'compensation_credit' })
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(1)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('failed')
    expect(prisma.event._rows).toHaveLength(0)
    expect(sendExtraFreeEventFallbackCreditEmail).toHaveBeenCalledTimes(1)
    expect(sendOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing:extra_free_event:auto_create_failed' }))
  })

  it('merge-blocking (STEP §34 compensation regression): compensation is guarded too — a checkout that races to a terminal state between the rolled-back primary tx and the compensation tx is never double-compensated', async () => {
    prismaGalleryRepository.createEvent.mockRejectedValue(new Error('boom'))
    // Starts genuinely checkout_created, so the PRIMARY transaction proceeds
    // past its own guard and really attempts createEvent (which fails,
    // rolling the primary tx back and releasing its lock) — exercising the
    // compensation transaction's OWN separate lock+fresh-read, not the
    // primary's. Between that rollback and the compensation transaction
    // starting, a concurrent delivery (e.g. async_payment_succeeded winning
    // the race) reaches a terminal state first.
    const prisma = createFakeTransactionalPrisma({
      owner: [seedOwner({ extraEventCredits: 0 })],
      event: [],
      extraFreeEventCheckout: [seedCheckout({ status: 'checkout_created' })],
    })
    const realTransaction = prisma.$transaction
    let transactionCallCount = 0
    prisma.$transaction = vi.fn((fn) => {
      transactionCallCount += 1
      if (transactionCallCount === 2) {
        // Mutate the ROOT row directly, simulating a concurrent delivery
        // that genuinely committed a credit_granted write between the
        // primary transaction's rollback and this compensation
        // transaction's own snapshot/lock. Must happen BEFORE
        // realTransaction runs — it snapshots the root's current rows
        // immediately on entry, so mutating inside its own callback would
        // be too late to affect that snapshot.
        prisma.extraFreeEventCheckout._rows[0].status = 'credit_granted'
      }
      return realTransaction(fn)
    })

    const result = await fulfillExtraFreeEventBuyAndCreate({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout({ status: 'checkout_created' }),
    })

    expect(result).toEqual({ status: 'skipped', reason: 'already_credit_granted' })
    expect(transactionCallCount).toBe(2)
    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    // No compensation credit granted on top of whatever the concurrent
    // winner already did.
    expect(owner.extraEventCredits).toBe(0)
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('credit_granted')
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
  })

  it('works correctly with NO finalizeInTransaction hook on both the primary and compensation paths', async () => {
    prismaGalleryRepository.createEvent.mockImplementation(async ({ name, prismaClient }) =>
      prismaClient.event.create({ data: { id: 'event-1', slug: 'birthday-party', name } }),
    )
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], event: [], extraFreeEventCheckout: [seedCheckout()] })
    const result = await fulfillExtraFreeEventBuyAndCreate({
      prisma,
      session: makeSession(),
      ownerId: 'owner-1',
      intent: 'extra_event',
      pendingCheckout: seedCheckout(),
    })
    expect(result.status).toBe('fulfilled')
  })

  it('re-throws StripeWebhookFencingError from the primary transaction without running the compensation saga', async () => {
    prismaGalleryRepository.createEvent.mockRejectedValue(new StripeWebhookFencingError('lost the lease'))
    const prisma = createFakeTransactionalPrisma({ owner: [seedOwner()], event: [], extraFreeEventCheckout: [seedCheckout()] })

    await expect(
      fulfillExtraFreeEventBuyAndCreate({
        prisma,
        session: makeSession(),
        ownerId: 'owner-1',
        intent: 'extra_event',
        pendingCheckout: seedCheckout(),
      }),
    ).rejects.toBeInstanceOf(StripeWebhookFencingError)

    const owner = await prisma.owner.findUnique({ where: { id: 'owner-1' } })
    expect(owner.extraEventCredits).toBe(0)
    expect(sendExtraFreeEventFallbackCreditEmail).not.toHaveBeenCalled()
  })
})

describe('expireExtraFreeEventCheckout', () => {
  it('transitions a checkout_created row to expired, completedAt stays null', async () => {
    const prisma = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout()] })
    const result = await expireExtraFreeEventCheckout({ prisma, pendingCheckout: seedCheckout() })

    expect(result).toEqual({ status: 'expired', checkoutId: 'checkout-1' })
    const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
    expect(checkout.status).toBe('expired')
    expect(checkout.completedAt).toBeNull()
  })

  it.each(['auto_created', 'credit_granted', 'failed', 'expired'])(
    'merge-blocking: never downgrades an already-terminal status (%s)',
    async (terminalStatus) => {
      const prisma = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout({ status: terminalStatus })] })
      const result = await expireExtraFreeEventCheckout({ prisma, pendingCheckout: seedCheckout({ status: terminalStatus }) })

      expect(result).toEqual({ status: 'skipped', reason: `already_${terminalStatus}` })
      const checkout = await prisma.extraFreeEventCheckout.findUnique({ where: { id: 'checkout-1' } })
      expect(checkout.status).toBe(terminalStatus)
    },
  )

  it('duplicate expiration is idempotent — second call is a no-op skip', async () => {
    const prisma = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout()] })
    const first = await expireExtraFreeEventCheckout({ prisma, pendingCheckout: seedCheckout() })
    expect(first.status).toBe('expired')

    const second = await expireExtraFreeEventCheckout({ prisma, pendingCheckout: seedCheckout() })
    expect(second).toEqual({ status: 'skipped', reason: 'already_expired' })
  })

  it('works correctly with NO finalizeInTransaction hook', async () => {
    const prisma = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout()] })
    const result = await expireExtraFreeEventCheckout({ prisma, pendingCheckout: seedCheckout() })
    expect(result.status).toBe('expired')
  })

  it('calls finalizeInTransaction exactly once, both on the real transition and on a no-op skip', async () => {
    const prisma1 = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout()] })
    const hook1 = vi.fn().mockResolvedValue(undefined)
    await expireExtraFreeEventCheckout({ prisma: prisma1, pendingCheckout: seedCheckout(), finalizeInTransaction: hook1 })
    expect(hook1).toHaveBeenCalledTimes(1)

    const prisma2 = createFakeTransactionalPrisma({ extraFreeEventCheckout: [seedCheckout({ status: 'auto_created' })] })
    const hook2 = vi.fn().mockResolvedValue(undefined)
    await expireExtraFreeEventCheckout({ prisma: prisma2, pendingCheckout: seedCheckout({ status: 'auto_created' }), finalizeInTransaction: hook2 })
    expect(hook2).toHaveBeenCalledTimes(1)
  })
})
