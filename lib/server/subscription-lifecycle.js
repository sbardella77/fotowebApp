/**
 * SnapRooms — Subscription lifecycle helpers.
 *
 * Pure, testable logic for interpreting Stripe subscription status,
 * grace periods, and effective premium access.
 */

import { isPremiumPlan } from '@/lib/event-access'

export const GRACE_PERIOD_DAYS = 7

export const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  CANCELED: 'canceled',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
}

const ACTIVE_STATUSES = new Set([
  SUBSCRIPTION_STATUSES.ACTIVE,
  SUBSCRIPTION_STATUSES.TRIALING,
])

const BILLING_INTERVAL_MAP = {
  month: 'monthly',
  year: 'annual',
}

function deriveBillingInterval(subscription) {
  if (!subscription || !Array.isArray(subscription.items?.data) || !subscription.items.data.length) {
    return null
  }
  const interval = subscription.items.data[0]?.price?.recurring?.interval
  return BILLING_INTERVAL_MAP[interval] || null
}

const GRACE_ELIGIBLE_STATUSES = new Set([
  SUBSCRIPTION_STATUSES.PAST_DUE,
  SUBSCRIPTION_STATUSES.UNPAID,
  SUBSCRIPTION_STATUSES.INCOMPLETE,
  SUBSCRIPTION_STATUSES.INCOMPLETE_EXPIRED,
])

function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Determine whether a subscription status keeps the user in an effective
 * premium state during a valid grace window.
 */
export function isGraceActive(graceUntil) {
  if (!graceUntil) return false
  return new Date(graceUntil) > new Date()
}

/**
 * Resolve the effective subscription access state for an owner.
 *
 * @param {Object} owner — Owner record with plan, subscriptionStatus, etc.
 * @returns {Object}
 */
export function resolveSubscriptionAccessState(owner = {}) {
  const now = new Date()
  const plan = owner.plan || 'free'
  const subscriptionStatus = owner.subscriptionStatus || null
  const paymentFailedAt = owner.paymentFailedAt || null
  const subscriptionGraceUntil = owner.subscriptionGraceUntil || null
  const subscriptionCanceledAt = owner.subscriptionCanceledAt || null
  const subscriptionCancelAtPeriodEnd = owner.subscriptionCancelAtPeriodEnd || false
  const subscriptionCurrentPeriodEnd = owner.subscriptionCurrentPeriodEnd || null
  const stripeSubscriptionId = owner.stripeSubscriptionId || null

  const isPastDue = subscriptionStatus === SUBSCRIPTION_STATUSES.PAST_DUE
  const isUnpaid = subscriptionStatus === SUBSCRIPTION_STATUSES.UNPAID
  const isCanceled = subscriptionStatus === SUBSCRIPTION_STATUSES.CANCELED
  const graceActive = isGraceActive(subscriptionGraceUntil)
  const graceExpired = subscriptionGraceUntil && !graceActive

  const isCancellationScheduled = subscriptionCancelAtPeriodEnd && !!subscriptionCurrentPeriodEnd
  const cancellationPeriodActive =
    isCancellationScheduled && new Date(subscriptionCurrentPeriodEnd) > now

  let accountPremiumActive = false
  if (isPremiumPlan(plan)) {
    if (!subscriptionStatus) {
      // Legacy owners without explicit subscription status are treated as active.
      accountPremiumActive = true
    } else if (ACTIVE_STATUSES.has(subscriptionStatus)) {
      accountPremiumActive = true
    } else if (GRACE_ELIGIBLE_STATUSES.has(subscriptionStatus) && graceActive) {
      accountPremiumActive = true
    }
  }

  // A scheduled cancellation overrides premium access: active only until period end.
  const effectivePremiumActive = isCancellationScheduled
    ? cancellationPeriodActive
    : accountPremiumActive

  const dashboardBillingWarning =
    isPastDue || isUnpaid || graceExpired || (isCanceled && !!subscriptionCanceledAt)

  const dashboardCancellationInfo = isCancellationScheduled && cancellationPeriodActive && !isCanceled

  const billingActionRequired =
    isPastDue || isUnpaid || graceExpired || (!!paymentFailedAt && graceExpired)

  const canManageSubscription =
    isPremiumPlan(plan) || !!stripeSubscriptionId || !!subscriptionCanceledAt

  return {
    subscriptionStatus,
    isPastDue,
    isUnpaid,
    isCanceled,
    isCancellationScheduled,
    cancellationPeriodActive,
    graceActive,
    graceExpired,
    accountPremiumActive: effectivePremiumActive,
    dashboardBillingWarning,
    dashboardCancellationInfo,
    billingActionRequired,
    canManageSubscription,
  }
}

/**
 * Build the Prisma update payload for a failed invoice.
 *
 * @param {Object} invoice — Stripe invoice object
 * @returns {Object}
 */
export function buildPaymentFailedUpdate(invoice = {}) {
  const now = new Date()
  const graceUntil = addDays(now, GRACE_PERIOD_DAYS)

  const lastPaymentError =
    invoice.payment_intent?.last_payment_error?.message || null

  return {
    subscriptionStatus: SUBSCRIPTION_STATUSES.PAST_DUE,
    paymentFailedAt: now,
    subscriptionGraceUntil: graceUntil,
    lastInvoiceId: invoice.id || null,
    lastInvoiceStatus: invoice.status || null,
    lastPaymentError: lastPaymentError ? lastPaymentError.slice(0, 500) : null,
  }
}

/**
 * Determine whether a failed invoice has already been handled for an owner.
 *
 * Idempotency is keyed on the invoice ID and the presence of a recorded
 * payment failure timestamp. This avoids reprocessing when Stripe retries the
 * same invoice or when the owner's subscriptionStatus has changed in the
 * meantime.
 *
 * @param {Object} owner — Owner record
 * @param {Object} invoice — Stripe invoice object
 * @returns {boolean}
 */
export function isPaymentFailureAlreadyHandled(owner = {}, invoice = {}) {
  if (!owner.lastInvoiceId || !invoice.id) return false
  return owner.lastInvoiceId === invoice.id && !!owner.paymentFailedAt
}

/**
 * Build the Prisma update payload when a subscription payment succeeds.
 *
 * @param {Object} invoice — Stripe invoice object
 * @returns {Object}
 */
export function buildPaymentSucceededUpdate(invoice = {}) {
  return {
    plan: 'professional',
    subscriptionStatus: SUBSCRIPTION_STATUSES.ACTIVE,
    paymentFailedAt: null,
    subscriptionGraceUntil: null,
    subscriptionCanceledAt: null,
    lastInvoiceId: invoice.id || null,
    lastInvoiceStatus: invoice.status || null,
    lastPaymentError: null,
  }
}

/**
 * Decide the owner plan that corresponds to a Stripe subscription status,
 * respecting any active grace period.
 *
 * @param {Object} params
 * @param {string} params.status — Stripe subscription status
 * @param {string} params.currentPlan — current owner.plan
 * @param {Date|null} params.subscriptionGraceUntil
 * @returns {string}
 */
export function computeOwnerPlanFromSubscriptionStatus({
  status,
  currentPlan,
  subscriptionGraceUntil,
}) {
  if (ACTIVE_STATUSES.has(status)) {
    return 'professional'
  }

  if (status === SUBSCRIPTION_STATUSES.PAST_DUE) {
    // Keep current plan; the grace period governs effective access.
    return currentPlan
  }

  if (GRACE_ELIGIBLE_STATUSES.has(status)) {
    // Remain on current plan only while the payment grace window is open.
    return isGraceActive(subscriptionGraceUntil) ? currentPlan : 'free'
  }

  if (status === SUBSCRIPTION_STATUSES.CANCELED) {
    return 'free'
  }

  // Unknown status: do not change plan.
  return currentPlan
}

/**
 * Build the Prisma update payload for a customer.subscription.updated event.
 *
 * Accepts either a raw `status` string (legacy) or a full Stripe subscription
 * object via `subscription`, so `cancel_at_period_end` and `current_period_end`
 * can be handled.
 *
 * @param {Object} params
 * @param {string} [params.status] — Stripe subscription status (legacy)
 * @param {Object} [params.subscription] — Stripe subscription object
 * @param {Object} params.owner — current Owner record
 * @returns {Object}
 */
export function buildSubscriptionUpdatedData({ status, subscription, owner = {} }) {
  const now = new Date()
  const effectiveStatus = status || subscription?.status
  const cancelAtPeriodEnd = subscription?.cancel_at_period_end ?? false
  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null
  const currentPlan = owner.plan || 'free'

  const newPlan = computeOwnerPlanFromSubscriptionStatus({
    status: effectiveStatus,
    currentPlan,
    subscriptionGraceUntil: owner.subscriptionGraceUntil,
  })

  const update = {
    plan: newPlan,
    subscriptionStatus: effectiveStatus,
    planUpdatedAt: now,
  }

  const subscriptionBillingInterval = deriveBillingInterval(subscription)

  if (ACTIVE_STATUSES.has(effectiveStatus)) {
    update.paymentFailedAt = null
    update.subscriptionGraceUntil = null
    update.lastPaymentError = null

    if (cancelAtPeriodEnd) {
      // User canceled at period end: keep Professional active until period end.
      update.plan = currentPlan
      update.subscriptionCancelAtPeriodEnd = true
      update.subscriptionCurrentPeriodEnd = currentPeriodEnd
      if (!owner.subscriptionCancelScheduledAt) {
        update.subscriptionCancelScheduledAt = now
      }
      // subscriptionCanceledAt stays null until the subscription actually ends.
      if (subscriptionBillingInterval) {
        update.subscriptionBillingInterval = subscriptionBillingInterval
      }
    } else {
      // Active/trialing and not scheduled for cancellation: clear any schedule.
      update.subscriptionCancelAtPeriodEnd = false
      update.subscriptionCurrentPeriodEnd = null
      update.subscriptionCancelScheduledAt = null
      update.subscriptionCanceledAt = null
      if (subscriptionBillingInterval) {
        update.subscriptionBillingInterval = subscriptionBillingInterval
      }
    }
  } else if (effectiveStatus === SUBSCRIPTION_STATUSES.PAST_DUE) {
    if (!owner.paymentFailedAt) {
      update.paymentFailedAt = now
    }
    if (!owner.subscriptionGraceUntil) {
      update.subscriptionGraceUntil = addDays(now, GRACE_PERIOD_DAYS)
    }
  } else if (GRACE_ELIGIBLE_STATUSES.has(effectiveStatus)) {
    if (!isGraceActive(owner.subscriptionGraceUntil)) {
      // Grace has expired; clear transient failure state.
      update.paymentFailedAt = null
      update.subscriptionGraceUntil = null
      update.lastPaymentError = null
    }
  } else if (effectiveStatus === SUBSCRIPTION_STATUSES.CANCELED) {
    update.stripeSubscriptionId = null
    update.paymentFailedAt = null
    update.subscriptionGraceUntil = null
    update.lastPaymentError = null
    update.subscriptionCanceledAt = now
    update.subscriptionCancelAtPeriodEnd = false
    update.subscriptionCurrentPeriodEnd = null
    update.subscriptionCancelScheduledAt = null
    update.subscriptionBillingInterval = null
  }

  return update
}

/**
 * Build the Prisma update payload for a customer.subscription.deleted event.
 *
 * @returns {Object}
 */
export function buildSubscriptionDeletedData() {
  const now = new Date()
  return {
    plan: 'free',
    stripeSubscriptionId: null,
    subscriptionStatus: SUBSCRIPTION_STATUSES.CANCELED,
    paymentFailedAt: null,
    subscriptionGraceUntil: null,
    lastPaymentError: null,
    subscriptionCanceledAt: now,
    subscriptionCancelAtPeriodEnd: false,
    subscriptionCurrentPeriodEnd: null,
    subscriptionCancelScheduledAt: null,
    subscriptionBillingInterval: null,
    planUpdatedAt: now,
  }
}
