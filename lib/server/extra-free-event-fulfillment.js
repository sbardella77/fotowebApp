import { Prisma } from '@prisma/client'
import { StripeWebhookFencingError } from './stripe-webhook-receipt.js'
import {
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
  sendExtraFreeEventCreditGrantedEmail,
} from './billing-emails.js'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { getOwnerAnalyticsId } from '@/lib/analytics/identity'
import {
  EVENT_CHECKOUT_COMPLETED,
  EVENT_UPSELL_CONVERSION,
  EXTRA_FREE_EVENT_AUTO_CREATE_FAILED,
  EXTRA_FREE_EVENT_AUTO_CREATE_SUCCESS,
} from '@/lib/analytics/events'
import { sendOpsAlert } from './ops-alerts.js'

/**
 * Extra Free Event fulfillment — shared business logic (STEP: billing PR 1).
 *
 * Callable by the checkout.session.completed / checkout.session.async_payment_succeeded
 * webhook handlers today, and by a future reconciliation job without any
 * StripeWebhookEvent receipt at all. Every function here:
 *
 *   - owns its own short prisma.$transaction (row lock + fresh status
 *     re-read + business write), never holds it open across network/Stripe
 *     I/O, and never receives one from the caller;
 *   - only ever produces a new fulfillment when the checkout's CURRENT
 *     (freshly re-read, lock-held) status is exactly 'checkout_created' —
 *     every other status (auto_created, credit_granted, failed, expired, or
 *     row-not-found) is a safe no-op, never a downgrade;
 *   - returns a plain domain result object — never a NextResponse/Response,
 *     never a StripeWebhookEvent-shaped object. The caller (a webhook route
 *     today) is the adapter that turns this into an HTTP response;
 *   - accepts an OPTIONAL `finalizeInTransaction(tx)` hook, invoked as the
 *     LAST statement inside the same transaction, on every terminal branch
 *     (fulfilled or skipped) — never for a case where no transaction runs
 *     at all. Named for what it does: it runs *inside* the transaction,
 *     before commit, not after. A webhook caller supplies
 *     `(tx) => markStripeWebhookEventProcessed({prisma: tx, eventId, attempt})`
 *     to keep receipt finalization atomic with the business write, exactly
 *     as today. A future reconciliation caller supplies nothing — no fake
 *     Stripe event id, no fake receipt row, no duplicated transaction code.
 *     The hook must do DB-only work: no network/Stripe/email calls belong
 *     here, since it runs inside an open transaction.
 *   - re-throws StripeWebhookFencingError unchanged (another worker already
 *     reclaimed this delivery — the caller's own wrapper handles it);
 *     re-throws every other unexpected error after sending its own
 *     detailed ops alert, letting the caller decide how to turn "the
 *     domain function threw" into its own failure response.
 */

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app').replace(/\/$/, '')
}

/**
 * Credit-only fulfillment (the checkout's postPurchaseAction is not
 * 'create_event') — grants exactly one extraEventCredits and marks the
 * checkout 'credit_granted'.
 *
 * @param {{
 *   prisma: object,
 *   session: { id: string, customer?: string, metadata?: object },
 *   ownerId: string,
 *   intent: string,
 *   pendingCheckout: { id: string },
 *   finalizeInTransaction?: (tx: object) => Promise<void>,
 * }} args
 * @returns {Promise<{status:'fulfilled', kind:'credit_granted', checkoutId:string, ownerId:string, owner:object}
 *   | {status:'skipped', reason:string}>}
 */
export async function fulfillExtraFreeEventCreditCanonical({
  prisma,
  session,
  ownerId,
  intent,
  pendingCheckout,
  finalizeInTransaction,
}) {
  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      // Pessimistic lock: serialize concurrent webhook/async-event deliveries
      // for the same checkout.
      await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pendingCheckout.id} FOR UPDATE`

      const fresh = await tx.extraFreeEventCheckout.findUnique({ where: { id: pendingCheckout.id } })
      if (!fresh || fresh.status !== 'checkout_created') {
        if (finalizeInTransaction) await finalizeInTransaction(tx)
        return { skipped: true, reason: fresh ? `already_${fresh.status}` : 'checkout_not_found' }
      }

      const owner = await tx.owner.update({
        where: { id: ownerId },
        data: {
          extraEventCredits: { increment: 1 },
          extraEventCheckoutSessionId: session.id,
          updatedAt: new Date(),
        },
      })

      await tx.extraFreeEventCheckout.update({
        where: { id: fresh.id },
        data: {
          status: 'credit_granted',
          stripeCheckoutSessionId: session.id,
          completedAt: new Date(),
        },
      })

      await tx.upsellEvent.create({
        data: {
          eventName: EVENT_UPSELL_CONVERSION,
          upsellType: session.metadata?.upsellType || 'extra_event',
          source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
          ctaPlan: 'extra_event',
          ownerId: ownerId || null,
        },
      })

      if (finalizeInTransaction) await finalizeInTransaction(tx)

      return { owner }
    })
  } catch (error) {
    if (error instanceof StripeWebhookFencingError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      console.warn('[extra-free-event-fulfillment] Owner not found for credit grant, skipping:', ownerId)
      return { status: 'skipped', reason: 'owner_not_found' }
    }
    console.error('[extra-free-event-fulfillment] Failed to grant extra free event credit:', error)
    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:extra_free_event:credit_grant_failed',
      title: 'Extra Free Event credit grant failed',
      message: error.message,
      context: { ownerId, pendingCheckoutId: pendingCheckout?.id },
    })
    throw error
  }

  if (result.skipped) {
    return { status: 'skipped', reason: result.reason }
  }

  const updatedOwner = result.owner

  trackServerEvent(
    EVENT_CHECKOUT_COMPLETED,
    {
      owner_id: ownerId,
      billing_intent: intent,
      product_type: session.metadata?.productType || 'extra_free_event',
      restrictions: session.metadata?.restrictions || 'free_plan',
      stripe_session_id: session.id,
      stripe_customer_id: session.customer,
      extra_event_credits: updatedOwner.extraEventCredits,
    },
    { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
  )

  trackServerEvent(
    EVENT_UPSELL_CONVERSION,
    {
      owner_id: ownerId,
      billing_intent: intent,
      upsell_type: session.metadata?.upsellType || 'extra_event',
      product_type: session.metadata?.productType || 'extra_free_event',
      restrictions: session.metadata?.restrictions || 'free_plan',
      source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
      stripe_session_id: session.id,
      stripe_customer_id: session.customer,
      extra_event_credits: updatedOwner.extraEventCredits,
    },
    { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
  )

  console.log(`[extra-free-event-fulfillment] Owner ${updatedOwner.email} granted extra free event credit. Total credits: ${updatedOwner.extraEventCredits}`)

  await sendExtraFreeEventCreditGrantedEmail({
    owner: updatedOwner,
    credits: updatedOwner.extraEventCredits,
    appUrl: getAppUrl(),
  })

  return { status: 'fulfilled', kind: 'credit_granted', checkoutId: pendingCheckout.id, ownerId, owner: updatedOwner }
}

/**
 * "Buy and create" fulfillment (postPurchaseAction === 'create_event') —
 * auto-creates the Event for the customer, or, if that fails, grants a
 * compensating credit instead (status 'failed' — meaning payment succeeded
 * and was compensated, never "customer didn't pay").
 *
 * @param {{
 *   prisma: object,
 *   session: object,
 *   ownerId: string,
 *   intent: string,
 *   pendingCheckout: { id: string, eventName?: string },
 *   finalizeInTransaction?: (tx: object) => Promise<void>,
 * }} args
 */
export async function fulfillExtraFreeEventBuyAndCreate({
  prisma,
  session,
  ownerId,
  intent,
  pendingCheckout,
  finalizeInTransaction,
}) {
  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true },
  })
  if (!owner) {
    console.warn('[extra-free-event-fulfillment] Owner not found for auto-create, skipping:', ownerId)
    return { status: 'skipped', reason: 'owner_not_found' }
  }

  try {
    const { prismaGalleryRepository } = await import('./prisma-gallery-repository.js')

    const result = await prisma.$transaction(async (tx) => {
      // Pessimistic lock: serialize concurrent webhook/async-event deliveries
      // for the same checkout.
      await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pendingCheckout.id} FOR UPDATE`

      const fresh = await tx.extraFreeEventCheckout.findUnique({ where: { id: pendingCheckout.id } })
      if (!fresh || fresh.status !== 'checkout_created') {
        if (finalizeInTransaction) await finalizeInTransaction(tx)
        return { skipped: true, reason: fresh ? `already_${fresh.status}` : 'checkout_not_found' }
      }

      const event = await prismaGalleryRepository.createEvent({ name: fresh.eventName, prismaClient: tx })

      await tx.event.update({
        where: { id: event.id },
        data: { ownerId: owner.id, ownerEmail: owner.email },
      })

      await tx.extraFreeEventCheckout.update({
        where: { id: fresh.id },
        data: {
          status: 'auto_created',
          stripeCheckoutSessionId: session.id,
          createdEventId: event.id,
          createdEventSlug: event.slug,
          completedAt: new Date(),
          autoCreatedAt: new Date(),
        },
      })

      if (finalizeInTransaction) await finalizeInTransaction(tx)

      return { event }
    })

    if (result.skipped) {
      return { status: 'skipped', reason: result.reason }
    }

    trackServerEvent(
      EVENT_CHECKOUT_COMPLETED,
      {
        owner_id: ownerId,
        billing_intent: intent,
        product_type: session.metadata?.productType || 'extra_free_event',
        restrictions: session.metadata?.restrictions || 'free_plan',
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
        pending_checkout_id: pendingCheckout.id,
      },
      { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
    )

    trackServerEvent(
      EVENT_UPSELL_CONVERSION,
      {
        owner_id: ownerId,
        billing_intent: intent,
        upsell_type: session.metadata?.upsellType || 'extra_event',
        product_type: session.metadata?.productType || 'extra_free_event',
        restrictions: session.metadata?.restrictions || 'free_plan',
        source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
        pending_checkout_id: pendingCheckout.id,
      },
      { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
    )

    trackServerEvent(
      EXTRA_FREE_EVENT_AUTO_CREATE_SUCCESS,
      {
        pending_checkout_id: pendingCheckout.id,
        checkout_session_id: session.id,
        event_slug: result.event.slug,
        source: 'stripe_webhook',
      },
      { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
    )

    console.log(`[extra-free-event-fulfillment] Auto-created event ${result.event.slug} for pending checkout ${pendingCheckout.id}`)

    await sendExtraFreeEventCreatedEmail({ owner, event: result.event, appUrl: getAppUrl() })

    return { status: 'fulfilled', kind: 'auto_created', checkoutId: pendingCheckout.id, ownerId, event: result.event }
  } catch (error) {
    if (error instanceof StripeWebhookFencingError) throw error

    console.error('[extra-free-event-fulfillment] Auto-create event failed, granting fallback credit:', {
      pendingCheckoutId: pendingCheckout.id,
      error: error.message,
    })

    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:extra_free_event:auto_create_failed',
      title: 'Extra Free Event auto-create failed; fallback credit granted',
      message: error.message,
      context: { ownerId, pendingCheckoutId: pendingCheckout.id, eventName: pendingCheckout.eventName },
    })

    try {
      const compensation = await prisma.$transaction(async (tx) => {
        // Same lock/fresh-guard as the primary path: the first transaction's
        // lock was released on rollback above, so a concurrent delivery
        // (a Stripe retry, or async_payment_succeeded racing this same
        // checkout) could have already reached a terminal state in the
        // meantime. Never overwrite a state that's no longer 'checkout_created'.
        await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pendingCheckout.id} FOR UPDATE`
        const fresh = await tx.extraFreeEventCheckout.findUnique({ where: { id: pendingCheckout.id } })
        if (!fresh || fresh.status !== 'checkout_created') {
          if (finalizeInTransaction) await finalizeInTransaction(tx)
          return { skipped: true, reason: fresh ? `already_${fresh.status}` : 'checkout_not_found' }
        }

        await tx.owner.update({
          where: { id: ownerId },
          data: {
            extraEventCredits: { increment: 1 },
            extraEventCheckoutSessionId: session.id,
            updatedAt: new Date(),
          },
        })
        await tx.extraFreeEventCheckout.update({
          where: { id: fresh.id },
          data: {
            status: 'failed',
            stripeCheckoutSessionId: session.id,
            errorMessage: String(error?.message || 'auto_create_failed').slice(0, 500),
            completedAt: new Date(),
          },
        })

        if (finalizeInTransaction) await finalizeInTransaction(tx)

        return { skipped: false }
      })

      if (compensation.skipped) {
        return { status: 'skipped', reason: compensation.reason }
      }

      trackServerEvent(
        EXTRA_FREE_EVENT_AUTO_CREATE_FAILED,
        {
          pending_checkout_id: pendingCheckout.id,
          checkout_session_id: session.id,
          fallback_credit_granted: true,
          reason: error.message,
          source: 'stripe_webhook',
        },
        { distinctId: getOwnerAnalyticsId(ownerId), personProfile: true },
      )

      await sendExtraFreeEventFallbackCreditEmail({ owner, pending: pendingCheckout, appUrl: getAppUrl() })

      return { status: 'fulfilled', kind: 'compensation_credit', checkoutId: pendingCheckout.id, ownerId, reason: error.message }
    } catch (fallbackError) {
      if (fallbackError instanceof StripeWebhookFencingError) throw fallbackError
      console.error('[extra-free-event-fulfillment] Fallback credit grant also failed:', fallbackError)
      await sendOpsAlert({
        severity: 'critical',
        type: 'billing:extra_free_event:fallback_credit_failed',
        title: 'Extra Free Event fallback credit grant failed',
        message: fallbackError.message,
        context: { ownerId, pendingCheckoutId: pendingCheckout.id, eventName: pendingCheckout.eventName },
      })
      throw fallbackError
    }
  }
}

/**
 * Expires a checkout still in 'checkout_created' — the Stripe Checkout
 * Session itself reached a terminal 'expired' state (unpaid, unpayable).
 * Never downgrades any other status. `completedAt` is deliberately left
 * null: it currently means "a payment-related completion happened here" in
 * every other writer, and reusing it for a non-payment terminal event would
 * be misleading to a future reader. `status='expired'` + the row's own
 * `updatedAt` (auto-set on every write) already unambiguously capture when
 * expiration was recorded, with no schema change needed.
 *
 * @param {{
 *   prisma: object,
 *   pendingCheckout: { id: string },
 *   finalizeInTransaction?: (tx: object) => Promise<void>,
 * }} args
 * @returns {Promise<{status:'expired', checkoutId:string} | {status:'skipped', reason:string}>}
 */
export async function expireExtraFreeEventCheckout({ prisma, pendingCheckout, finalizeInTransaction }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pendingCheckout.id} FOR UPDATE`

    const fresh = await tx.extraFreeEventCheckout.findUnique({ where: { id: pendingCheckout.id } })
    if (!fresh || fresh.status !== 'checkout_created') {
      if (finalizeInTransaction) await finalizeInTransaction(tx)
      return { status: 'skipped', reason: fresh ? `already_${fresh.status}` : 'checkout_not_found' }
    }

    await tx.extraFreeEventCheckout.update({
      where: { id: fresh.id },
      data: { status: 'expired' },
    })

    if (finalizeInTransaction) await finalizeInTransaction(tx)

    return { status: 'expired', checkoutId: fresh.id }
  })
}
