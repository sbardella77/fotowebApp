/**
 * SnapRooms — Stripe billing ordering: feature flag + Stripe-origin
 * bootstrap for the subscription/invoice cursor domains (STEP 5.3b design).
 *
 * This module has no HTTP awareness and produces no side effects beyond
 * Stripe API reads and the single Prisma transaction each bootstrap call
 * performs. It is not wired into any webhook handler yet.
 */

import { markStripeWebhookEventProcessed } from '@/lib/server/stripe-webhook-receipt'
import { buildSubscriptionUpdatedData } from '@/lib/server/subscription-lifecycle'

export const SUBSCRIPTION_DOMAIN_EVENT_TYPES = Object.freeze([
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

export const INVOICE_DOMAIN_EVENT_TYPES = Object.freeze([
  'invoice.payment_failed',
  'invoice.payment_succeeded',
])

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes'])

/**
 * Centralized feature-flag read. Every other module must call this instead
 * of reading `process.env.STRIPE_ORDERING_GUARD_ENABLED` directly.
 */
export function isStripeOrderingGuardEnabled() {
  const raw = process.env.STRIPE_ORDERING_GUARD_ENABLED
  if (typeof raw !== 'string') return false
  return TRUTHY_FLAG_VALUES.has(raw.trim().toLowerCase())
}

/**
 * Thrown when a bootstrap call's trigger event references a subscription id
 * that conflicts with the owner's already-scoped
 * `stripeBillingCursorSubscriptionId`. Classifying this (stale vs.
 * pre-checkout race vs. genuinely foreign) is deferred to a future handler —
 * this module only refuses to silently overwrite the scope.
 */
export class StripeBillingScopeConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StripeBillingScopeConflictError'
  }
}

function assertValidTriggerEvent(stripeEvent, domain) {
  if (!stripeEvent || typeof stripeEvent !== 'object') {
    throw new Error(`stripe-billing-ordering: stripeEvent is required (domain=${domain})`)
  }
  if (typeof stripeEvent.id !== 'string' || stripeEvent.id.trim().length === 0) {
    throw new Error(`stripe-billing-ordering: stripeEvent.id must be a non-empty string (domain=${domain})`)
  }
  if (!Number.isInteger(stripeEvent.created) || stripeEvent.created <= 0) {
    throw new Error(`stripe-billing-ordering: stripeEvent.created must be a positive integer Unix timestamp (domain=${domain})`)
  }
  const expectedTypes = domain === 'subscription' ? SUBSCRIPTION_DOMAIN_EVENT_TYPES : INVOICE_DOMAIN_EVENT_TYPES
  if (!expectedTypes.includes(stripeEvent.type)) {
    throw new Error(`stripe-billing-ordering: unexpected event type "${stripeEvent.type}" for domain=${domain}`)
  }
  const relevantId = domain === 'subscription'
    ? stripeEvent.data?.object?.id
    : stripeEvent.data?.object?.subscription
  if (typeof relevantId !== 'string' || relevantId.trim().length === 0) {
    throw new Error(`stripe-billing-ordering: could not resolve subscription id from trigger event (domain=${domain})`)
  }
  return relevantId
}

function assertOwnerShape(owner) {
  if (!owner || typeof owner.id !== 'string' || owner.id.trim().length === 0) {
    throw new Error('stripe-billing-ordering: owner.id is required')
  }
}

function assertNoScopeConflict(owner, subscriptionId) {
  const scope = owner.stripeBillingCursorSubscriptionId
  if (scope !== null && scope !== undefined && scope !== subscriptionId) {
    throw new StripeBillingScopeConflictError(
      `stripe-billing-ordering: owner ${owner.id} is scoped to ${scope}, trigger references ${subscriptionId} — refusing to silently overwrite scope`
    )
  }
}

function matchesSubscriptionEvent(stripeApiEvent, subscriptionId) {
  return stripeApiEvent?.data?.object?.id === subscriptionId
}

function matchesInvoiceEvent(stripeApiEvent, subscriptionId) {
  return stripeApiEvent?.data?.object?.subscription === subscriptionId
}

/**
 * Find the Stripe-origin high-watermark for a domain within [T, now], where
 * T is the trigger event's own `created`. Never reads any local clock.
 *
 * Stripe's list endpoints return results in reverse-chronological order
 * (newest first, verified against docs.stripe.com/pagination). Because of
 * this, the FIRST matching event encountered while walking pages forward is
 * guaranteed to be the maximum `created` among all matches within the
 * window — nothing encountered afterwards (older pages) can be newer. We
 * still must keep paginating past non-matching events (they belong to other
 * subscriptions on the same Stripe account) until either a match is found
 * or `has_more` is false.
 */
async function findStripeDomainWatermark({ stripe, triggerEvent, subscriptionId, types, matchesEvent }) {
  const T = triggerEvent.created
  let watermark = T
  let cursor

  for (;;) {
    const page = await stripe.events.list({
      types,
      created: { gte: T },
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    })

    for (const apiEvent of page.data) {
      if (matchesEvent(apiEvent, subscriptionId)) {
        watermark = Math.max(watermark, apiEvent.created)
        return watermark
      }
    }

    if (!page.has_more || page.data.length === 0) break
    cursor = page.data[page.data.length - 1].id
  }

  return watermark
}

/**
 * Bootstrap the subscription-domain cursor for `owner` using `stripeEvent`
 * as the trigger. Writes only subscription-domain fields (STEP 5.2 strict
 * ownership) plus the scope and subscription marker. Never touches the
 * invoice marker.
 *
 * @returns {Promise<{action: 'BOOTSTRAPPED', watermark: number} | {action: 'ALREADY_BOOTSTRAPPED'}>}
 */
export async function bootstrapStripeSubscriptionOrdering({ stripe, prisma, owner, stripeEvent, attempt }) {
  const subscriptionId = assertValidTriggerEvent(stripeEvent, 'subscription')
  assertOwnerShape(owner)
  assertNoScopeConflict(owner, subscriptionId)

  if (owner.lastStripeSubscriptionEventCreated !== null && owner.lastStripeSubscriptionEventCreated !== undefined) {
    return { action: 'ALREADY_BOOTSTRAPPED' }
  }

  // Retention check: if the trigger itself is no longer retrievable, the
  // [T, now] window the LIST step below relies on cannot be guaranteed
  // fully observable. Fail closed — do not invent a watermark. Stripe (not
  // our clock) decides availability.
  await stripe.events.retrieve(stripeEvent.id)

  const watermark = await findStripeDomainWatermark({
    stripe,
    triggerEvent: stripeEvent,
    subscriptionId,
    types: SUBSCRIPTION_DOMAIN_EVENT_TYPES,
    matchesEvent: matchesSubscriptionEvent,
  })

  // LIST → RETRIEVE invariant (STEP 5.3b proof): the retrieve must happen
  // strictly after the watermark is finalized. Reversing this order can
  // write a stale canonical snapshot alongside a fresher marker, silently
  // discarding a real, not-yet-retrieved state transition forever.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  const update = buildSubscriptionUpdatedData({ subscription, owner })

  await prisma.$transaction(async (tx) => {
    await tx.owner.update({
      where: { id: owner.id },
      data: {
        ...update,
        stripeBillingCursorSubscriptionId: subscriptionId,
        lastStripeSubscriptionEventCreated: BigInt(watermark),
      },
    })
    await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEvent.id, attempt })
  })

  return { action: 'BOOTSTRAPPED', watermark }
}

/**
 * Bootstrap the invoice-domain cursor for `owner` using `stripeEvent` as the
 * trigger. Writes only invoice-domain fields (STEP 5.2 strict ownership)
 * plus the scope and invoice marker. Never touches the subscription marker
 * or any lifecycle/access field.
 *
 * @returns {Promise<{action: 'BOOTSTRAPPED', watermark: number} | {action: 'ALREADY_BOOTSTRAPPED'}>}
 */
export async function bootstrapStripeInvoiceOrdering({ stripe, prisma, owner, stripeEvent, attempt }) {
  const subscriptionId = assertValidTriggerEvent(stripeEvent, 'invoice')
  assertOwnerShape(owner)
  assertNoScopeConflict(owner, subscriptionId)

  if (owner.lastStripeInvoiceEventCreated !== null && owner.lastStripeInvoiceEventCreated !== undefined) {
    return { action: 'ALREADY_BOOTSTRAPPED' }
  }

  await stripe.events.retrieve(stripeEvent.id)

  const watermark = await findStripeDomainWatermark({
    stripe,
    triggerEvent: stripeEvent,
    subscriptionId,
    types: INVOICE_DOMAIN_EVENT_TYPES,
    matchesEvent: matchesInvoiceEvent,
  })

  // Same LIST → RETRIEVE invariant as the subscription path.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] })
  const latestInvoice = subscription.latest_invoice

  if (typeof latestInvoice === 'string') {
    throw new Error(
      `stripe-billing-ordering: latest_invoice was not expanded on subscription ${subscriptionId} — malformed retrieve`
    )
  }

  const update = {
    lastInvoiceId: latestInvoice?.id ?? null,
    lastInvoiceStatus: latestInvoice?.status ?? null,
  }

  // Only a confirmed 'paid' status lets us safely clear the invoice-domain
  // failure bookkeeping. Any other status (open, uncollectible, void, or no
  // invoice at all) does not carry enough information to reconstruct
  // paymentFailedAt/lastPaymentError with certainty — preserve whatever is
  // already on the row instead of inventing a value (STEP 5.3b F).
  if (latestInvoice?.status === 'paid') {
    update.paymentFailedAt = null
    update.lastPaymentError = null
  }

  await prisma.$transaction(async (tx) => {
    await tx.owner.update({
      where: { id: owner.id },
      data: {
        ...update,
        stripeBillingCursorSubscriptionId: subscriptionId,
        lastStripeInvoiceEventCreated: BigInt(watermark),
      },
    })
    await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEvent.id, attempt })
  })

  return { action: 'BOOTSTRAPPED', watermark }
}
