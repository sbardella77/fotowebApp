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
  it('sets past_due, paymentFailedAt and grace window', () => {
    const update = buildPaymentFailedUpdate({ id: 'in_123', status: 'open' })
    expect(update.subscriptionStatus).toBe('past_due')
    expect(update.paymentFailedAt).toBeInstanceOf(Date)
    expect(update.subscriptionGraceUntil).toBeInstanceOf(Date)
    expect(update.lastInvoiceId).toBe('in_123')
    expect(update.lastInvoiceStatus).toBe('open')
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
  it('clears failure state and restores active', () => {
    const update = buildPaymentSucceededUpdate({ id: 'in_456', status: 'paid' })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('active')
    expect(update.paymentFailedAt).toBeNull()
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.subscriptionCanceledAt).toBeNull()
    expect(update.lastInvoiceId).toBe('in_456')
    expect(update.lastInvoiceStatus).toBe('paid')
    expect(update.lastPaymentError).toBeNull()
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
  it('active clears failure state', () => {
    const update = buildSubscriptionUpdatedData({ status: 'active', owner: { plan: 'professional' } })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('active')
    expect(update.paymentFailedAt).toBeNull()
    expect(update.subscriptionGraceUntil).toBeNull()
    expect(update.subscriptionCanceledAt).toBeNull()
  })

  it('past_due sets grace if missing', () => {
    const update = buildSubscriptionUpdatedData({ status: 'past_due', owner: { plan: 'professional' } })
    expect(update.plan).toBe('professional')
    expect(update.subscriptionStatus).toBe('past_due')
    expect(update.paymentFailedAt).toBeInstanceOf(Date)
    expect(update.subscriptionGraceUntil).toBeInstanceOf(Date)
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
    // The helper should not overwrite existing timestamps; it omits them from the payload.
    expect(update.paymentFailedAt).toBeUndefined()
    expect(update.subscriptionGraceUntil).toBeUndefined()
    expect(update.plan).toBe('professional')
  })

  it('unpaid after grace downgrades to free and clears grace', () => {
    const update = buildSubscriptionUpdatedData({
      status: 'unpaid',
      owner: {
        plan: 'professional',
        subscriptionGraceUntil: dateDaysFromNow(-1),
      },
    })
    expect(update.plan).toBe('free')
    expect(update.paymentFailedAt).toBeNull()
    expect(update.subscriptionGraceUntil).toBeNull()
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
  })
})
