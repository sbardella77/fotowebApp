import { describe, it, expect, vi } from 'vitest'
import { inspectExtraFreeEventCheckouts, ReconciliationBucket } from '@/lib/server/extra-free-event-reconciliation'

// BILLING PR 2A — read-only reconciliation classifier. Every test here
// proves either a classification outcome or the module's read-only
// contract itself. No test ever asserts a mutation occurred — several
// assert the opposite: that mutation is IMPOSSIBLE.

const NOW = new Date('2026-08-19T12:00:00.000Z')
const nowFn = () => NOW

function hoursAgo(h) {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000)
}

function makeCandidate(overrides = {}) {
  return {
    id: 'checkout-fake-1',
    status: 'checkout_created',
    stripeCheckoutSessionId: 'cs_fake_1',
    updatedAt: hoursAgo(2),
    completedAt: null,
    createdEventId: null,
    autoCreatedAt: null,
    ...overrides,
  }
}

function makeSession(overrides = {}) {
  return {
    id: 'cs_fake_1',
    status: 'open',
    payment_status: 'unpaid',
    mode: 'payment',
    metadata: { intent: 'extra_event' },
    payment_intent: null,
    ...overrides,
  }
}

// Read-only Prisma fake: findMany works; every mutation-capable method
// throws if ever invoked, so a bug that accidentally calls one fails loudly
// rather than silently mutating a real database in a future context.
function makeReadOnlyPrisma(candidates) {
  const findMany = vi.fn().mockResolvedValue(candidates)
  const mutationNames = ['update', 'updateMany', 'create', 'upsert', 'delete', 'deleteMany']
  const extraFreeEventCheckout = { findMany }
  for (const name of mutationNames) {
    extraFreeEventCheckout[name] = () => {
      throw new Error(`FORBIDDEN: prisma.extraFreeEventCheckout.${name} must never be called by the reconciliation classifier`)
    }
  }
  return new Proxy(
    { extraFreeEventCheckout },
    {
      get(target, prop) {
        if (prop in target) return target[prop]
        if (prop === '$transaction' || prop === '$executeRaw' || prop === '$executeRawUnsafe' || prop === '$queryRaw') {
          throw new Error(`FORBIDDEN: prisma.${String(prop)} must never be called by the reconciliation classifier`)
        }
        return undefined
      },
    },
  )
}

// Read-only Stripe fake: only checkout.sessions.retrieve and
// paymentIntents.retrieve are implemented. Any other method access throws —
// proven via Proxy, not merely "not implemented in this mock".
function makeReadOnlyStripe({ retrieveImpl, paymentIntentRetrieveImpl } = {}) {
  const sessions = new Proxy(
    { retrieve: retrieveImpl || vi.fn() },
    {
      get(target, prop) {
        if (prop === 'retrieve') return target.retrieve
        throw new Error(`FORBIDDEN: stripe.checkout.sessions.${String(prop)} must never be called by the reconciliation classifier`)
      },
    },
  )
  const paymentIntents = new Proxy(
    { retrieve: paymentIntentRetrieveImpl || vi.fn() },
    {
      get(target, prop) {
        if (prop === 'retrieve') return target.retrieve
        throw new Error(`FORBIDDEN: stripe.paymentIntents.${String(prop)} must never be called by the reconciliation classifier`)
      },
    },
  )
  return new Proxy(
    { checkout: { sessions }, paymentIntents },
    {
      get(target, prop) {
        if (prop in target) return target[prop]
        throw new Error(`FORBIDDEN: stripe.${String(prop)} must never be accessed by the reconciliation classifier`)
      },
    },
  )
}

function assertSumInvariant(result) {
  const sum =
    result[ReconciliationBucket.OPEN_UNPAID] +
    result[ReconciliationBucket.EXPIRED_UNPAID] +
    result[ReconciliationBucket.COMPLETE_PAID_LOCAL_UNFULFILLED] +
    result[ReconciliationBucket.COMPLETE_PAID_LOCAL_FULFILLED] +
    result[ReconciliationBucket.COMPLETE_UNPAID_OR_PENDING] +
    result[ReconciliationBucket.UNEXPECTED] +
    result[ReconciliationBucket.STRIPE_RETRIEVE_FAILED] +
    result[ReconciliationBucket.LOCAL_AMBIGUOUS]
  expect(sum).toBe(result.checked)
}

describe('inspectExtraFreeEventCheckouts — zero candidates', () => {
  it('returns all-zero aggregate, never calls Stripe', async () => {
    const prisma = makeReadOnlyPrisma([])
    const retrieveImpl = vi.fn()
    const stripe = makeReadOnlyStripe({ retrieveImpl })

    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })

    expect(result.mode).toBe('dry-run')
    expect(result.checked).toBe(0)
    for (const bucket of Object.values(ReconciliationBucket)) {
      expect(result[bucket]).toBe(0)
    }
    expect(retrieveImpl).not.toHaveBeenCalled()
    assertSumInvariant(result)
  })
})

describe('inspectExtraFreeEventCheckouts — state matrix', () => {
  it('open + unpaid → openUnpaid, zero writes possible', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'open', payment_status: 'unpaid' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result.checked).toBe(1)
    expect(result[ReconciliationBucket.OPEN_UNPAID]).toBe(1)
    assertSumInvariant(result)
  })

  it('expired + unpaid → expiredUnpaid, zero writes possible', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'expired', payment_status: 'unpaid' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.EXPIRED_UNPAID]).toBe(1)
    assertSumInvariant(result)
  })

  it('merge-blocking: complete + paid + local NOT fulfilled → completePaidLocalUnfulfilled, ZERO fulfillment/DB writes possible', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate({ createdEventId: null, autoCreatedAt: null, completedAt: null })])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'complete', payment_status: 'paid' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.COMPLETE_PAID_LOCAL_UNFULFILLED]).toBe(1)
    // The read-only Prisma/Stripe fakes above would have thrown had ANY
    // mutation method been invoked — reaching this assertion at all is
    // itself proof no mutation occurred.
    assertSumInvariant(result)
  })

  it('complete + paid + local ALREADY fulfilled → completePaidLocalFulfilled, no mutation', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate({ createdEventId: 'event-fake-1', autoCreatedAt: hoursAgo(3) })])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'complete', payment_status: 'paid' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.COMPLETE_PAID_LOCAL_FULFILLED]).toBe(1)
    assertSumInvariant(result)
  })

  it('complete + unpaid → completeUnpaidOrPending, conditional PaymentIntent retrieve refines diagnostics only', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const paymentIntentRetrieveImpl = vi.fn().mockResolvedValue({ id: 'pi_fake_1', status: 'requires_payment_method' })
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(
        makeSession({ status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_fake_1' }),
      ),
      paymentIntentRetrieveImpl,
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.COMPLETE_UNPAID_OR_PENDING]).toBe(1)
    expect(paymentIntentRetrieveImpl).toHaveBeenCalledWith('pi_fake_1')
    expect(result.completeUnpaidOrPendingBreakdown.paymentIntentRequiresPaymentMethod).toBe(1)
    assertSumInvariant(result)
  })

  it('complete + unpaid with no payment_intent reference skips PaymentIntent retrieval entirely', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const paymentIntentRetrieveImpl = vi.fn()
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'complete', payment_status: 'unpaid', payment_intent: null })),
      paymentIntentRetrieveImpl,
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.COMPLETE_UNPAID_OR_PENDING]).toBe(1)
    expect(paymentIntentRetrieveImpl).not.toHaveBeenCalled()
  })

  it('PaymentIntent retrieval failure leaves the candidate safely unresolved in the breakdown, still counted as completeUnpaidOrPending', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_fake_2' })),
      paymentIntentRetrieveImpl: vi.fn().mockRejectedValue(new Error('network blip')),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.COMPLETE_UNPAID_OR_PENDING]).toBe(1)
    expect(result.completeUnpaidOrPendingBreakdown.paymentIntentUnavailable).toBe(1)
    assertSumInvariant(result)
  })
})

describe('inspectExtraFreeEventCheckouts — per-item failure isolation', () => {
  it('one candidate failing Stripe retrieval does not abort the batch — sibling still classified', async () => {
    const candidates = [
      makeCandidate({ id: 'checkout-fake-1', stripeCheckoutSessionId: 'cs_fake_1' }),
      makeCandidate({ id: 'checkout-fake-2', stripeCheckoutSessionId: 'cs_fake_2' }),
    ]
    const prisma = makeReadOnlyPrisma(candidates)
    const retrieveImpl = vi.fn().mockImplementation(async (id) => {
      if (id === 'cs_fake_1') throw new Error('stripe network error')
      return makeSession({ id, status: 'open', payment_status: 'unpaid' })
    })
    const stripe = makeReadOnlyStripe({ retrieveImpl })

    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result.checked).toBe(2)
    expect(result[ReconciliationBucket.STRIPE_RETRIEVE_FAILED]).toBe(1)
    expect(result[ReconciliationBucket.OPEN_UNPAID]).toBe(1)
    assertSumInvariant(result)
  })
})

describe('inspectExtraFreeEventCheckouts — identity/metadata/mode safety', () => {
  it('metadata.intent !== extra_event → unexpected, zero mutation', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ metadata: { intent: 'pro_event' } })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.UNEXPECTED]).toBe(1)
    assertSumInvariant(result)
  })

  it('mode !== payment → unexpected, zero mutation, no further business inference', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate()])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ mode: 'subscription' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.UNEXPECTED]).toBe(1)
    assertSumInvariant(result)
  })

  it('returned session.id mismatching the stored stripeCheckoutSessionId → unexpected (defense in depth)', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate({ stripeCheckoutSessionId: 'cs_expected' })])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(makeSession({ id: 'cs_different' })),
    })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.UNEXPECTED]).toBe(1)
  })
})

describe('inspectExtraFreeEventCheckouts — local data ambiguity', () => {
  it('completedAt set without createdEventId/autoCreatedAt on a checkout_created row → localAmbiguous, Stripe never consulted', async () => {
    const prisma = makeReadOnlyPrisma([makeCandidate({ completedAt: hoursAgo(1), createdEventId: null, autoCreatedAt: null })])
    const retrieveImpl = vi.fn()
    const stripe = makeReadOnlyStripe({ retrieveImpl })
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result[ReconciliationBucket.LOCAL_AMBIGUOUS]).toBe(1)
    expect(retrieveImpl).not.toHaveBeenCalled()
    assertSumInvariant(result)
  })
})

describe('inspectExtraFreeEventCheckouts — sum invariant across a mixed batch', () => {
  it('every candidate lands in exactly one bucket', async () => {
    const candidates = [
      makeCandidate({ id: 'c1', stripeCheckoutSessionId: 'cs_1' }),
      makeCandidate({ id: 'c2', stripeCheckoutSessionId: 'cs_2' }),
      makeCandidate({ id: 'c3', stripeCheckoutSessionId: 'cs_3' }),
      makeCandidate({ id: 'c4', stripeCheckoutSessionId: 'cs_4' }),
      makeCandidate({ id: 'c5', stripeCheckoutSessionId: 'cs_5', completedAt: hoursAgo(1) }),
    ]
    const prisma = makeReadOnlyPrisma(candidates)
    const retrieveImpl = vi.fn().mockImplementation(async (id) => {
      if (id === 'cs_1') return makeSession({ id, status: 'open', payment_status: 'unpaid' })
      if (id === 'cs_2') return makeSession({ id, status: 'expired', payment_status: 'unpaid' })
      if (id === 'cs_3') return makeSession({ id, status: 'complete', payment_status: 'paid' })
      if (id === 'cs_4') throw new Error('boom')
      throw new Error('should not be called for c5 (local ambiguous, short-circuits before Stripe)')
    })
    const stripe = makeReadOnlyStripe({ retrieveImpl })

    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    expect(result.checked).toBe(5)
    expect(result[ReconciliationBucket.OPEN_UNPAID]).toBe(1)
    expect(result[ReconciliationBucket.EXPIRED_UNPAID]).toBe(1)
    expect(result[ReconciliationBucket.COMPLETE_PAID_LOCAL_UNFULFILLED]).toBe(1)
    expect(result[ReconciliationBucket.STRIPE_RETRIEVE_FAILED]).toBe(1)
    expect(result[ReconciliationBucket.LOCAL_AMBIGUOUS]).toBe(1)
    assertSumInvariant(result)
  })
})

describe('inspectExtraFreeEventCheckouts — privacy', () => {
  it('merge-blocking: no distinctive checkout id, session id, or PaymentIntent id ever appears in the returned aggregate', async () => {
    const DISTINCTIVE_CHECKOUT_ID = 'checkout-SENTINEL-do-not-leak-9f8e7d'
    const DISTINCTIVE_SESSION_ID = 'cs_SENTINEL-do-not-leak-1a2b3c'
    const DISTINCTIVE_PI_ID = 'pi_SENTINEL-do-not-leak-4d5e6f'

    const prisma = makeReadOnlyPrisma([
      makeCandidate({ id: DISTINCTIVE_CHECKOUT_ID, stripeCheckoutSessionId: DISTINCTIVE_SESSION_ID }),
    ])
    const stripe = makeReadOnlyStripe({
      retrieveImpl: vi.fn().mockResolvedValue(
        makeSession({ id: DISTINCTIVE_SESSION_ID, status: 'complete', payment_status: 'unpaid', payment_intent: DISTINCTIVE_PI_ID }),
      ),
      paymentIntentRetrieveImpl: vi.fn().mockResolvedValue({ id: DISTINCTIVE_PI_ID, status: 'canceled' }),
    })

    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(DISTINCTIVE_CHECKOUT_ID)
    expect(serialized).not.toContain(DISTINCTIVE_SESSION_ID)
    expect(serialized).not.toContain(DISTINCTIVE_PI_ID)
  })
})

describe('inspectExtraFreeEventCheckouts — read-only contract enforcement', () => {
  it('merge-blocking: running the full state matrix against write-forbidding Prisma/Stripe fakes never throws a FORBIDDEN error', async () => {
    // If the classifier ever called a mutation method, the Proxy-based
    // fakes above would throw synchronously with a FORBIDDEN message —
    // this test exercises every bucket in one batch and asserts the whole
    // run completes without any such throw.
    const candidates = [
      makeCandidate({ id: 'c1', stripeCheckoutSessionId: 'cs_1' }),
      makeCandidate({ id: 'c2', stripeCheckoutSessionId: 'cs_2' }),
      makeCandidate({ id: 'c3', stripeCheckoutSessionId: 'cs_3' }),
      makeCandidate({ id: 'c4', stripeCheckoutSessionId: 'cs_4' }),
      makeCandidate({ id: 'c5', stripeCheckoutSessionId: 'cs_5' }),
      makeCandidate({ id: 'c6', stripeCheckoutSessionId: 'cs_6' }),
    ]
    const prisma = makeReadOnlyPrisma(candidates)
    const retrieveImpl = vi.fn().mockImplementation(async (id) => {
      const map = {
        cs_1: makeSession({ id, status: 'open', payment_status: 'unpaid' }),
        cs_2: makeSession({ id, status: 'expired', payment_status: 'unpaid' }),
        cs_3: makeSession({ id, status: 'complete', payment_status: 'paid' }),
        cs_4: makeSession({ id, status: 'complete', payment_status: 'unpaid' }),
        cs_5: makeSession({ id, metadata: { intent: 'pro_event' } }),
        cs_6: makeSession({ id, mode: 'subscription' }),
      }
      return map[id]
    })
    const stripe = makeReadOnlyStripe({ retrieveImpl })

    await expect(inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })).resolves.toBeDefined()
  })

  it('candidate query never selects owner email/event name/customer PII fields', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = { extraFreeEventCheckout: { findMany } }
    const stripe = makeReadOnlyStripe()
    await inspectExtraFreeEventCheckouts({ prisma, stripe, now: nowFn })
    const [args] = findMany.mock.calls[0]
    expect(args.select).not.toHaveProperty('ownerId')
    expect(args.select).not.toHaveProperty('eventName')
    expect(args.select).not.toHaveProperty('owner')
    expect(args.where.status).toBe('checkout_created')
  })
})
