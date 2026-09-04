import { describe, it, expect } from 'vitest'
import {
  resolveSubscriptionAccessState,
  buildPaymentFailedUpdate,
  buildPaymentSucceededUpdate,
  buildSubscriptionUpdatedData,
  buildSubscriptionDeletedData,
  computeOwnerPlanFromSubscriptionStatus,
  isPaymentFailureAlreadyHandled,
  GRACE_PERIOD_DAYS,
} from '@/lib/server/subscription-lifecycle'

function dateDaysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

describe('resolveSubscriptionAccessState', () => {
  it('treats legacy Professional owner without status as active premium', () => {
    const state = resolveSubscriptionAccessState({ plan: 'professional' })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.dashboardBillingWarning).toBe(false)
  })

  it('active status → premium active, no warning', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
    })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.dashboardBillingWarning).toBe(false)
    expect(state.billingActionRequired).toBe(false)
  })

  it('past_due within grace → premium active + warning', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'past_due',
      paymentFailedAt: new Date(),
      subscriptionGraceUntil: dateDaysFromNow(3),
    })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.isPastDue).toBe(true)
    expect(state.graceActive).toBe(true)
    expect(state.dashboardBillingWarning).toBe(true)
    expect(state.billingActionRequired).toBe(true)
  })

  it('past_due after grace → premium inactive + warning', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'past_due',
      paymentFailedAt: dateDaysFromNow(-10),
      subscriptionGraceUntil: dateDaysFromNow(-1),
    })
    expect(state.accountPremiumActive).toBe(false)
    expect(state.graceExpired).toBe(true)
    expect(state.dashboardBillingWarning).toBe(true)
    expect(state.billingActionRequired).toBe(true)
  })

  it('unpaid within grace → premium active', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'unpaid',
      subscriptionGraceUntil: dateDaysFromNow(2),
    })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.isUnpaid).toBe(true)
  })

  it('canceled → no premium, warning', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'free',
      subscriptionStatus: 'canceled',
      subscriptionCanceledAt: new Date(),
    })
    expect(state.accountPremiumActive).toBe(false)
    expect(state.isCanceled).toBe(true)
    expect(state.dashboardBillingWarning).toBe(true)
  })

  it('free plan is never premium', () => {
    const state = resolveSubscriptionAccessState({ plan: 'free', subscriptionStatus: 'active' })
    expect(state.accountPremiumActive).toBe(false)
  })

  it('canManageSubscription for active Professional', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_123',
    })
    expect(state.canManageSubscription).toBe(true)
  })
})

// canManageSubscription is portal ELIGIBILITY ("is there a real Stripe
// subscription the Customer Portal can manage?"), a narrower question than
// accountPremiumActive (app-level premium ENTITLEMENT). A legacy/inconsistent
// owner can be premium-entitled with no Stripe subscription at all — that
// state must never make the portal CTA eligible, even though it keeps full
// premium app access.
describe('canManageSubscription — portal eligibility contract', () => {
  it('1. professional plan + no stripeSubscriptionId -> false (the inconsistent-account bug state)', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      stripeSubscriptionId: null,
    })
    expect(state.canManageSubscription).toBe(false)
  })

  it('2. professional + active stripeSubscriptionId -> true', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_active_123',
    })
    expect(state.canManageSubscription).toBe(true)
  })

  it('3. cancel_at_period_end (still active until period end) + stripeSubscriptionId -> true', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_scheduled_cancel_123',
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd: dateDaysFromNow(10),
    })
    expect(state.canManageSubscription).toBe(true)
  })

  it('4. fully canceled subscription (stripeSubscriptionId cleared) -> false, even with a cancellation record', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'free',
      subscriptionStatus: 'canceled',
      stripeSubscriptionId: null,
      subscriptionCanceledAt: new Date(),
    })
    expect(state.canManageSubscription).toBe(false)
  })

  it('5. free plan, no subscription -> false', () => {
    const state = resolveSubscriptionAccessState({ plan: 'free' })
    expect(state.canManageSubscription).toBe(false)
  })

  it('6. one-off product purchasers (plan stays free, no stripeSubscriptionId) -> false', () => {
    // Pro Event / Wedding Pro / Extra Free Event never touch Owner.plan or
    // stripeSubscriptionId — Event.billingTier / Owner.extraEventCredits are
    // separate fields entirely (see checkout-session/route.js, webhook
    // route.js). A stripeCustomerId may exist (created at checkout for any
    // intent) but that alone must not grant portal eligibility.
    const state = resolveSubscriptionAccessState({
      plan: 'free',
      stripeSubscriptionId: null,
    })
    expect(state.canManageSubscription).toBe(false)
  })

  it('past_due and unpaid keep the portal eligible while stripeSubscriptionId is still present (grace period is useful for updating payment method)', () => {
    const pastDue = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'past_due',
      stripeSubscriptionId: 'sub_past_due_123',
      subscriptionGraceUntil: dateDaysFromNow(3),
    })
    expect(pastDue.canManageSubscription).toBe(true)

    const unpaid = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'unpaid',
      stripeSubscriptionId: 'sub_unpaid_123',
    })
    expect(unpaid.canManageSubscription).toBe(true)
  })

  it('trialing keeps the portal eligible while stripeSubscriptionId is present', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'trialing',
      stripeSubscriptionId: 'sub_trial_123',
    })
    expect(state.canManageSubscription).toBe(true)
  })

  it('7. accountPremiumActive semantics are unchanged by the canManageSubscription fix — a legacy professional owner with no subscription id keeps full premium access', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      stripeSubscriptionId: null,
      // no subscriptionStatus -> legacy-owner branch
    })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.canManageSubscription).toBe(false)
  })
})

describe('isPaymentFailureAlreadyHandled', () => {
  it('returns false for a brand new failed invoice', () => {
    const owner = { subscriptionStatus: 'active', lastInvoiceId: null, paymentFailedAt: null }
    expect(isPaymentFailureAlreadyHandled(owner, { id: 'in_123' })).toBe(false)
  })

  it('returns true when the same failed invoice is retried', () => {
    const owner = {
      subscriptionStatus: 'past_due',
      lastInvoiceId: 'in_123',
      paymentFailedAt: new Date(),
    }
    expect(isPaymentFailureAlreadyHandled(owner, { id: 'in_123' })).toBe(true)
  })

  it('returns true for a retried invoice even if subscriptionStatus has changed', () => {
    const owner = {
      subscriptionStatus: 'unpaid',
      lastInvoiceId: 'in_123',
      paymentFailedAt: new Date(),
    }
    expect(isPaymentFailureAlreadyHandled(owner, { id: 'in_123' })).toBe(true)
  })

  it('returns false for a different failed invoice', () => {
    const owner = {
      subscriptionStatus: 'past_due',
      lastInvoiceId: 'in_123',
      paymentFailedAt: new Date(),
    }
    expect(isPaymentFailureAlreadyHandled(owner, { id: 'in_456' })).toBe(false)
  })

  it('returns false after a successful payment cleared the failure timestamp', () => {
    const owner = {
      subscriptionStatus: 'active',
      lastInvoiceId: 'in_123',
      paymentFailedAt: null,
    }
    expect(isPaymentFailureAlreadyHandled(owner, { id: 'in_123' })).toBe(false)
  })
})

describe('buildPaymentFailedUpdate', () => {
  it('sets paymentFailedAt and invoice bookkeeping fields', () => {
    const update = buildPaymentFailedUpdate({ id: 'in_123', status: 'open' })
    expect(update.paymentFailedAt).toBeInstanceOf(Date)
    expect(update.lastInvoiceId).toBe('in_123')
    expect(update.lastInvoiceStatus).toBe('open')
  })

  it('never writes subscription-domain fields (field ownership)', () => {
    const update = buildPaymentFailedUpdate({ id: 'in_123', status: 'open' })
    expect(update.subscriptionStatus).toBeUndefined()
    expect(update.subscriptionGraceUntil).toBeUndefined()
    expect(update.plan).toBeUndefined()
    expect(update.subscriptionCanceledAt).toBeUndefined()
  })

  it('truncates long payment error messages', () => {
    const longMessage = 'x'.repeat(600)
    const update = buildPaymentFailedUpdate({
      id: 'in_123',
      status: 'open',
      payment_intent: { last_payment_error: { message: longMessage } },
    })
    expect(update.lastPaymentError.length).toBeLessThanOrEqual(500)
  })
})

describe('buildPaymentSucceededUpdate', () => {
  it('clears invoice-domain failure state and updates invoice bookkeeping', () => {
    const update = buildPaymentSucceededUpdate({ id: 'in_456', status: 'paid' })
    expect(update.paymentFailedAt).toBeNull()
    expect(update.lastInvoiceId).toBe('in_456')
    expect(update.lastInvoiceStatus).toBe('paid')
    expect(update.lastPaymentError).toBeNull()
  })

  it('never writes subscription-domain fields (field ownership)', () => {
    const update = buildPaymentSucceededUpdate({ id: 'in_456', status: 'paid' })
    expect(update.plan).toBeUndefined()
    expect(update.subscriptionStatus).toBeUndefined()
    expect(update.subscriptionGraceUntil).toBeUndefined()
    expect(update.subscriptionCanceledAt).toBeUndefined()
  })
})

describe('computeOwnerPlanFromSubscriptionStatus', () => {
  it('active → professional', () => {
    expect(computeOwnerPlanFromSubscriptionStatus({ status: 'active', currentPlan: 'free' })).toBe('professional')
  })

  it('trialing → professional', () => {
    expect(computeOwnerPlanFromSubscriptionStatus({ status: 'trialing', currentPlan: 'free' })).toBe('professional')
  })

  it('past_due keeps current plan', () => {
    expect(computeOwnerPlanFromSubscriptionStatus({ status: 'past_due', currentPlan: 'professional' })).toBe('professional')
  })

  it('unpaid within grace keeps current plan', () => {
    expect(
      computeOwnerPlanFromSubscriptionStatus({
        status: 'unpaid',
        currentPlan: 'professional',
        subscriptionGraceUntil: dateDaysFromNow(2),
      })
    ).toBe('professional')
  })

  it('unpaid after grace → free', () => {
    expect(
      computeOwnerPlanFromSubscriptionStatus({
        status: 'unpaid',
        currentPlan: 'professional',
        subscriptionGraceUntil: dateDaysFromNow(-1),
      })
    ).toBe('free')
  })

  it('canceled → free', () => {
    expect(computeOwnerPlanFromSubscriptionStatus({ status: 'canceled', currentPlan: 'professional' })).toBe('free')
  })
})

describe('buildSubscriptionUpdatedData', () => {
  it('active clears grace, does not touch invoice-domain fields', () => {
    const update = buildSubscriptionUpdatedData({ status: 'active', owner: { plan: 'professional' } })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('active')
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.subscriptionCanceledAt).toBeNull()
    expect(update.paymentFailedAt).toBeUndefined()
    expect(update.lastPaymentError).toBeUndefined()
  })

  it('past_due sets grace if missing, does not touch paymentFailedAt', () => {
    const update = buildSubscriptionUpdatedData({ status: 'past_due', owner: { plan: 'professional' } })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('past_due')
    expect(update.subscriptionGraceUntil).toBeInstanceOf(Date)
    expect(update.paymentFailedAt).toBeUndefined()
  })

  it('past_due preserves existing grace timestamp', () => {
    const existingGrace = dateDaysFromNow(5)
    const existingFailure = new Date()
    const update = buildSubscriptionUpdatedData({
      status: 'past_due',
      owner: {
        plan: 'professional',
        paymentFailedAt: existingFailure,
        subscriptionGraceUntil: existingGrace,
      },
    })
    // The helper omits subscriptionGraceUntil when a value already exists
    // (does not overwrite it), and never writes paymentFailedAt at all
    // (invoice-domain-only field).
    expect(update.paymentFailedAt).toBeUndefined()
    expect(update.subscriptionGraceUntil).toBeUndefined()
    expect(update.plan).toBe('professional')
  })

  it('unpaid after grace downgrades to free and clears grace, does not touch paymentFailedAt', () => {
    const update = buildSubscriptionUpdatedData({
      status: 'unpaid',
      owner: {
        plan: 'professional',
        subscriptionGraceUntil: dateDaysFromNow(-1),
      },
    })
    expect(update.plan).toBe('free')
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.paymentFailedAt).toBeUndefined()
  })

  it('active + cancel_at_period_end keeps professional and schedules cancellation', () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    const update = buildSubscriptionUpdatedData({
      subscription: { status: 'active', cancel_at_period_end: true, current_period_end: periodEnd },
      owner: { plan: 'professional' },
    })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('active')
    expect(update.subscriptionCancelAtPeriodEnd).toBe(true)
    expect(update.subscriptionCurrentPeriodEnd).toBeInstanceOf(Date)
    expect(update.subscriptionCancelScheduledAt).toBeInstanceOf(Date)
    expect(update.paymentFailedAt).toBeUndefined()
  })

  it('derives monthly billing interval from subscription items', () => {
    const update = buildSubscriptionUpdatedData({
      subscription: {
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: Date.now() / 1000 + 86400,
        items: { data: [{ price: { recurring: { interval: 'month' } } }] },
      },
      owner: { plan: 'professional' },
    })
    expect(update.subscriptionBillingInterval).toBe('monthly')
  })

  it('derives annual billing interval from subscription items', () => {
    const update = buildSubscriptionUpdatedData({
      subscription: {
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: Date.now() / 1000 + 86400,
        items: { data: [{ price: { recurring: { interval: 'year' } } }] },
      },
      owner: { plan: 'professional' },
    })
    expect(update.subscriptionBillingInterval).toBe('annual')
  })

  it('clears billing interval when subscription is canceled', () => {
    const update = buildSubscriptionUpdatedData({
      subscription: {
        status: 'canceled',
        items: { data: [{ price: { recurring: { interval: 'month' } } }] },
      },
      owner: { plan: 'professional', subscriptionBillingInterval: 'monthly' },
    })
    expect(update.plan).toBe('free')
    expect(update.subscriptionBillingInterval).toBeNull()
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.paymentFailedAt).toBeUndefined()
    expect(update.lastPaymentError).toBeUndefined()
  })

  it('active + cancel_at_period_end false clears scheduled flags', () => {
    const update = buildSubscriptionUpdatedData({
      subscription: { status: 'active', cancel_at_period_end: false, current_period_end: Date.now() / 1000 + 86400 },
      owner: {
        plan: 'professional',
        subscriptionCancelAtPeriodEnd: true,
        subscriptionCurrentPeriodEnd: new Date(),
        subscriptionCancelScheduledAt: new Date(),
      },
    })
    expect(update.subscriptionCancelAtPeriodEnd).toBe(false)
    expect(update.subscriptionCurrentPeriodEnd).toBeNull()
    expect(update.subscriptionCancelScheduledAt).toBeNull()
    expect(update.subscriptionCanceledAt).toBeNull()
  })
})

describe('buildSubscriptionDeletedData', () => {
  it('downgrades to free and records cancellation', () => {
    const update = buildSubscriptionDeletedData()
    expect(update.plan).toBe('free')
    expect(update.stripeSubscriptionId).toBeNull()
    expect(update.subscriptionStatus).toBe('canceled')
    expect(update.subscriptionCanceledAt).toBeInstanceOf(Date)
    expect(update.paymentFailedAt).toBeNull()
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.subscriptionCancelAtPeriodEnd).toBe(false)
    expect(update.subscriptionCurrentPeriodEnd).toBeNull()
    expect(update.subscriptionCancelScheduledAt).toBeNull()
    expect(update.subscriptionBillingInterval).toBeNull()
  })
})

describe('resolveSubscriptionAccessState scheduled cancellation', () => {
  it('keeps premium active until current_period_end when cancellation is scheduled', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd: dateDaysFromNow(5),
    })
    expect(state.accountPremiumActive).toBe(true)
    expect(state.isCancellationScheduled).toBe(true)
    expect(state.dashboardCancellationInfo).toBe(true)
    expect(state.dashboardBillingWarning).toBe(false)
  })

  it('downgrades after current_period_end expires', () => {
    const state = resolveSubscriptionAccessState({
      plan: 'professional',
      subscriptionStatus: 'active',
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd: dateDaysFromNow(-1),
    })
    expect(state.accountPremiumActive).toBe(false)
    expect(state.isCancellationScheduled).toBe(true)
    expect(state.dashboardCancellationInfo).toBe(false)
  })
})
