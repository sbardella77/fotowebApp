import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { getOwnerAnalyticsId } from '@/lib/analytics/identity'
import {
  buildPaymentFailedUpdate,
  buildPaymentSucceededUpdate,
  buildSubscriptionUpdatedData,
  buildSubscriptionDeletedData,
  resolveSubscriptionAccessState,
  isPaymentFailureAlreadyHandled,
  GRACE_PERIOD_DAYS,
} from '@/lib/server/subscription-lifecycle'
import {
  sendExtraFreeEventCreatedEmail,
  sendExtraFreeEventFallbackCreditEmail,
  sendExtraFreeEventCreditGrantedEmail,
  sendProEventPurchasedEmail,
  sendWeddingProPurchasedEmail,
  sendProfessionalActivatedEmail,
  sendProfessionalPaymentFailedEmail,
  sendProfessionalPaymentRecoveredEmail,
  sendProfessionalCanceledEmail,
  sendProfessionalCancellationScheduledEmail,
} from '@/lib/server/billing-emails'
import {
  EVENT_CHECKOUT_COMPLETED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED,
  EVENT_UPSELL_CONVERSION,
  EXTRA_FREE_EVENT_AUTO_CREATE_FAILED,
  EXTRA_FREE_EVENT_AUTO_CREATE_SUCCESS,
} from '@/lib/analytics/events'
import { sendOpsAlert } from '@/lib/server/ops-alerts'
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventProcessed,
  StripeWebhookClaimAction,
  StripeWebhookFencingError,
} from '@/lib/server/stripe-webhook-receipt'
import { processClaimedStripeWebhookEvent, StripeWebhookRunOutcome } from '@/lib/server/stripe-webhook-wrapper'
import {
  isStripeOrderingGuardEnabled,
  bootstrapStripeSubscriptionOrdering,
  bootstrapStripeInvoiceOrdering,
} from '@/lib/server/stripe-billing-ordering'
import {
  fulfillExtraFreeEventCreditCanonical,
  fulfillExtraFreeEventBuyAndCreate,
  expireExtraFreeEventCheckout,
} from '@/lib/server/extra-free-event-fulfillment'

export const dynamic = 'force-dynamic'

// The only Stripe event types this endpoint acts on. Anything else is
// acknowledged with 200 and never gets a durable receipt — there is no
// business action to protect, so claiming it would just grow the table.
const HANDLED_STRIPE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
])

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app').replace(/\/$/, '')
}

export async function POST(request) {
  const stripe = getStripe()
  const payload = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err.message)
    await sendOpsAlert({
      severity: 'warning',
      type: 'stripe:webhook:signature_failed',
      title: 'Stripe webhook signature verification failed',
      message: err.message,
      context: { stripeEventId: event?.id },
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Unsupported event types are decided from the (now signature-verified)
  // event alone — before touching Prisma at all — so their response never
  // depends on database availability.
  if (!HANDLED_STRIPE_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true })
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.error('[stripe/webhook] Database unavailable')
    await sendOpsAlert({
      severity: 'critical',
      type: 'db:unavailable',
      title: 'Database unavailable when handling Stripe webhook',
      message: 'Prisma client could not be initialized during a Stripe webhook delivery.',
      context: { stripeEventId: event?.id, stripeEventType: event?.type },
    })
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const stripeEventId = event.id
  const claim = await claimStripeWebhookEvent({ prisma, eventId: stripeEventId, eventType: event.type })

  if (claim.action === StripeWebhookClaimAction.ALREADY_PROCESSED) {
    return NextResponse.json({ received: true })
  }

  if (claim.action === StripeWebhookClaimAction.IN_PROGRESS) {
    // Retry-After is a hint, not a guarantee Stripe honors it exactly — the
    // non-2xx status alone is what keeps this delivery eligible for
    // Stripe's own retry/backoff policy.
    return NextResponse.json(
      { received: false, code: 'webhook_processing_in_progress' },
      { status: 503, headers: { 'Retry-After': '5' } }
    )
  }

  const processingAttempt = claim.receipt.attempts

  if (event.type === 'checkout.session.completed') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleCheckoutSessionCompleted({ event, prisma, attempt: processingAttempt }),
    })
  }

  if (event.type === 'checkout.session.async_payment_succeeded') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleCheckoutSessionAsyncPaymentSucceeded({ event, prisma, attempt: processingAttempt }),
    })
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleCheckoutSessionAsyncPaymentFailed({ event }),
    })
  }

  if (event.type === 'checkout.session.expired') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleCheckoutSessionExpired({ event, prisma, attempt: processingAttempt }),
    })
  }

  if (event.type === 'customer.subscription.updated') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleSubscriptionUpdated({ event, prisma, stripe, attempt: processingAttempt }),
    })
  }

  if (event.type === 'customer.subscription.deleted') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleSubscriptionDeleted({ event, prisma, stripe, attempt: processingAttempt }),
    })
  }

  if (event.type === 'invoice.payment_failed') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleInvoicePaymentFailed({ event, prisma, stripe, attempt: processingAttempt }),
    })
  }

  if (event.type === 'invoice.payment_succeeded') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleInvoicePaymentSucceeded({ event, prisma, stripe, attempt: processingAttempt }),
    })
  }
}

// ── checkout.session.completed ──
async function handleCheckoutSessionCompleted({ event, prisma, attempt }) {
  const session = event.data.object
  const intent = session.metadata?.intent
  const ownerId = session.metadata?.ownerId
  const eventId = session.metadata?.eventId

  // ── High-quality download unlock (guest or owner, no auth required) ──
  if (intent === 'high_quality_download') {
    if (!eventId) {
      // Nothing to write, so nothing to make atomic: the wrapper's
      // standalone markStripeWebhookEventProcessed on this legacy response
      // is already correct and sufficient.
      console.warn('[stripe/webhook] Missing eventId for high_quality_download')
      return NextResponse.json({ received: true })
    }

    // `eventId` above is the SnapRooms gallery Event id from checkout
    // metadata; `stripeEventId` is the Stripe webhook event id used to
    // fence the receipt — kept explicitly distinct within this branch.
    const stripeEventId = event.id

    const existing = await prisma.event.findFirst({
      where: { id: eventId, originalDownloadCheckoutSessionId: session.id },
    })
    if (existing) {
      // Already fulfilled: nothing to write, standalone finalization.
      console.log(`[stripe/webhook] Event ${existing.slug} already fulfilled for download unlock session ${session.id}`)
      return NextResponse.json({ received: true })
    }

    let updatedEvent
    try {
      await prisma.$transaction(async (tx) => {
        updatedEvent = await tx.event.update({
          where: { id: eventId },
          data: {
            originalDownloadUnlocked: true,
            originalDownloadCheckoutSessionId: session.id,
            updatedAt: new Date(),
          },
        })

        await tx.upsellEvent.create({
          data: {
            eventName: EVENT_UPSELL_CONVERSION,
            upsellType: session.metadata?.upsellType || 'original_quality_unlock',
            source: session.metadata?.upsellSource || 'lightbox',
            ctaPlan: 'unlock',
            eventId: eventId || null,
            eventSlug: session.metadata?.roomSlug || null,
          },
        })

        await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
      })
    } catch (dbError) {
      if (dbError instanceof StripeWebhookFencingError) {
        // Another worker already reclaimed this delivery; Prisma already
        // rolled back the Event/UpsellEvent writes above. Let the wrapper
        // handle it (503, no markFailed with this now-stale attempt).
        throw dbError
      }
      if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
        // The Event was deleted/unavailable: the transaction rolled back on
        // its own (no business state committed), so this is a legitimate
        // skip, not a finalized receipt — legacy response, standalone
        // finalization by the wrapper, never the tagged outcome.
        console.warn('[stripe/webhook] Event not found for fulfillment, skipping:', eventId)
        return NextResponse.json({ received: true })
      }
      console.error('[stripe/webhook] Failed to unlock original downloads:', dbError)
      await sendOpsAlert({
        severity: 'critical',
        type: 'billing:webhook:download_unlock_failed',
        title: 'Original download unlock fulfillment failed',
        message: dbError.message,
        context: {
          stripeEventId: event?.id,
          stripeSessionId: session.id,
          eventId,
          roomSlug: session.metadata?.roomSlug,
        },
      })
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    trackServerEvent(
      EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED,
      {
        billing_intent: intent,
        event_id: eventId,
        room_slug: session.metadata?.roomSlug || null,
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
      },
      // No Owner auth is required for this purchase (guest or owner) — never
      // fall back to session.customer_email here, only the opaque Stripe
      // customer id or the room's own eventId.
      { distinctId: session.customer || eventId }
    )

    trackServerEvent(
      EVENT_UPSELL_CONVERSION,
      {
        billing_intent: intent,
        upsell_type: session.metadata?.upsellType || 'original_quality_unlock',
        source: session.metadata?.upsellSource || 'lightbox',
        event_id: eventId,
        room_slug: session.metadata?.roomSlug || null,
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
      },
      // No Owner auth is required for this purchase (guest or owner) — never
      // fall back to session.customer_email here, only the opaque Stripe
      // customer id or the room's own eventId.
      { distinctId: session.customer || eventId }
    )

    console.log(`[stripe/webhook] Event ${updatedEvent.slug} unlocked for original quality downloads`)

    return {
      kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
      response: NextResponse.json({ received: true }),
    }
  }

  if (!ownerId) {
    console.warn('[stripe/webhook] Missing ownerId in session metadata')
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:missing_owner_id',
      title: 'Stripe checkout.session.completed missing ownerId',
      message: 'The checkout session metadata did not include ownerId.',
      context: { stripeEventId: event?.id, stripeSessionId: session.id, intent },
    })
    return NextResponse.json({ received: true })
  }

  // ── Extra Free Event one-time credit ──
  if (intent === 'extra_event') {
    const postPurchaseAction = session.metadata?.postPurchaseAction

    // Stripe webhook event id, kept explicit and distinct from any
    // business-entity id to fence the receipt for the canonical credit path.
    const stripeEventId = event.id

    // New canonical path: every extra_event checkout has a unique pending row.
    const pendingCheckout = await prisma.extraFreeEventCheckout.findUnique({
      where: { stripeCheckoutSessionId: session.id },
    })

    if (pendingCheckout) {
      // Payment-safety gate (STEP: billing PR 1) — checkout.session.completed
      // fires whether or not payment has actually settled. Synchronous
      // methods (cards) are 'paid' by the time this fires, but delayed/async
      // methods (e.g. bank debits) can complete this event with
      // payment_status still 'unpaid', settling later via a separate
      // checkout.session.async_payment_succeeded event. Fulfillment must
      // never run ahead of confirmed payment — no code-level restriction to
      // synchronous-only payment methods exists (checkout-session/route.js
      // sets no payment_method_types), so this cannot be assumed away.
      if (session.payment_status !== 'paid') {
        console.log(
          `[stripe/webhook] Extra free event checkout ${pendingCheckout.id} completed with payment_status!=paid, deferring fulfillment to async_payment_succeeded`,
        )
        return NextResponse.json({ received: true })
      }

      const finalizeInTransaction = (tx) => markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
      const fulfillmentArgs = { prisma, session, ownerId, intent, pendingCheckout, finalizeInTransaction }

      await (postPurchaseAction === 'create_event'
        ? fulfillExtraFreeEventBuyAndCreate(fulfillmentArgs)
        : fulfillExtraFreeEventCreditCanonical(fulfillmentArgs))

      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }

    // Legacy fallback: sessions created before the pending-row migration —
    // no local ExtraFreeEventCheckout row exists to gate/correlate against.
    if (session.payment_status !== 'paid') {
      console.log('[stripe/webhook] Legacy extra free event session completed with payment_status!=paid, deferring fulfillment')
      return NextResponse.json({ received: true })
    }
    return await fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent, stripeEventId, attempt })
  }

  // ── Event-based one-time purchase ──
  if (intent === 'pro_event' || intent === 'wedding_pro') {
    if (!eventId) {
      console.warn('[stripe/webhook] Missing eventId for event-based purchase:', intent)
      return NextResponse.json({ received: true })
    }

    // `eventId` above is the SnapRooms gallery Event id from checkout
    // metadata; `stripeEventId` is the Stripe webhook event id used to
    // fence the receipt — kept explicitly distinct within this branch.
    const stripeEventId = event.id

    // Idempotency: skip if this exact session already fulfilled
    const existing = await prisma.event.findFirst({
      where: { id: eventId, stripeCheckoutSessionId: session.id },
    })
    if (existing) {
      console.log(`[stripe/webhook] Event ${existing.slug} already fulfilled for session ${session.id}`)
      return NextResponse.json({ received: true })
    }

    const eventBeforeUpdate = await prisma.event.findUnique({
      where: { id: eventId },
      select: { billingTier: true },
    })
    if (eventBeforeUpdate?.billingTier === intent) {
      console.log(`[stripe/webhook] Event ${eventId} already has billingTier=${intent}, skipping`)
      return NextResponse.json({ received: true })
    }
    if (intent === 'pro_event' && eventBeforeUpdate?.billingTier === 'wedding_pro') {
      console.log(`[stripe/webhook] Event ${eventId} is already Wedding Pro, skipping pro_event downgrade`)
      return NextResponse.json({ received: true })
    }

    let updatedEvent
    try {
      await prisma.$transaction(async (tx) => {
        updatedEvent = await tx.event.update({
          where: { id: eventId },
          data: {
            billingTier: intent,
            stripeCheckoutSessionId: session.id,
            billingPurchasedAt: new Date(),
          },
        })

        await tx.upsellEvent.create({
          data: {
            eventName: EVENT_UPSELL_CONVERSION,
            upsellType: session.metadata?.upsellType || intent,
            source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
            ctaPlan: intent,
            ownerId: ownerId || null,
            eventId: eventId || null,
            eventSlug: session.metadata?.roomSlug || null,
          },
        })

        await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
      })
    } catch (dbError) {
      if (dbError instanceof StripeWebhookFencingError) {
        // Another worker already reclaimed this delivery; Prisma already
        // rolled back the Event/UpsellEvent writes above. Let the wrapper
        // handle it (503, no markFailed with this now-stale attempt).
        throw dbError
      }
      // If event was deleted, don't retry forever
      if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
        console.warn('[stripe/webhook] Event not found for fulfillment, skipping:', eventId)
        return NextResponse.json({ received: true })
      }
      console.error('[stripe/webhook] Failed to update event billing:', dbError)
      await sendOpsAlert({
        severity: 'critical',
        type: 'billing:webhook:event_upgrade_failed',
        title: 'Event-level purchase fulfillment failed',
        message: dbError.message,
        context: {
          stripeEventId: event?.id,
          stripeSessionId: session.id,
          ownerId,
          eventId,
          intent,
          roomSlug: session.metadata?.roomSlug,
        },
      })
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    const appUrl = getAppUrl()
    if (intent === 'wedding_pro') {
      await sendWeddingProPurchasedEmail({ owner: { id: ownerId, email: session.metadata?.ownerEmail }, event: updatedEvent, appUrl })
    } else {
      await sendProEventPurchasedEmail({ owner: { id: ownerId, email: session.metadata?.ownerEmail }, event: updatedEvent, appUrl })
    }

    trackServerEvent(
      EVENT_CHECKOUT_COMPLETED,
      {
        owner_id: ownerId,
        billing_intent: intent,
        event_id: eventId,
        room_slug: session.metadata?.roomSlug || null,
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
      },
      { distinctId: getOwnerAnalyticsId(ownerId) }
    )

    trackServerEvent(
      EVENT_UPSELL_CONVERSION,
      {
        owner_id: ownerId,
        billing_intent: intent,
        upsell_type: session.metadata?.upsellType || intent,
        source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
        event_id: eventId,
        room_slug: session.metadata?.roomSlug || null,
        stripe_session_id: session.id,
        stripe_customer_id: session.customer,
      },
      { distinctId: getOwnerAnalyticsId(ownerId) }
    )

    console.log(`[stripe/webhook] Event ${updatedEvent.slug} upgraded to ${intent}`)

    return {
      kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
      response: NextResponse.json({ received: true }),
    }
  }

  // ── Account-level recurring subscription ──
  else if (intent === 'professional') {
    // Stripe webhook event id, kept explicit and distinct from any
    // business-entity id to fence the receipt for this branch.
    const stripeEventId = event.id

    // Idempotency: skip if this exact session already fulfilled
    const existing = await prisma.owner.findFirst({
      where: { id: ownerId, stripeCheckoutSessionId: session.id },
    })
    if (existing) {
      console.log(`[stripe/webhook] Owner ${existing.email} already fulfilled for session ${session.id}`)
      return NextResponse.json({ received: true })
    }

    let owner
    try {
      await prisma.$transaction(async (tx) => {
        owner = await tx.owner.update({
          where: { id: ownerId },
          data: {
            plan: 'professional',
            subscriptionStatus: 'active',
            stripeSubscriptionId: session.subscription || null,
            stripeCheckoutSessionId: session.id,
            subscriptionBillingInterval: session.metadata?.billingInterval === 'annual' ? 'annual' : 'monthly',
            planUpdatedAt: new Date(),
            // Clear any previous failure/cancellation timestamps on re-subscription.
            paymentFailedAt: null,
            subscriptionGraceUntil: null,
            subscriptionCanceledAt: null,
            lastPaymentError: null,
            // Billing ordering cursor: a new subscription scope starts with no
            // history — markers stay null until the first real webhook
            // establishes a Stripe-origin watermark (STEP 5.3b design).
            stripeBillingCursorSubscriptionId: session.subscription || null,
            lastStripeSubscriptionEventCreated: null,
            lastStripeInvoiceEventCreated: null,
          },
        })

        await tx.upsellEvent.create({
          data: {
            eventName: EVENT_UPSELL_CONVERSION,
            upsellType: session.metadata?.upsellType || intent,
            source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
            ctaPlan: intent,
            ownerId: owner.id,
          },
        })

        await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
      })
    } catch (dbError) {
      if (dbError instanceof StripeWebhookFencingError) {
        // Another worker already reclaimed this delivery; Prisma already
        // rolled back the Owner/UpsellEvent writes above. Let the wrapper
        // handle it (503, no markFailed with this now-stale attempt).
        throw dbError
      }
      if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
        console.warn('[stripe/webhook] Owner not found for fulfillment, skipping:', ownerId)
        return NextResponse.json({ received: true })
      }
      console.error('[stripe/webhook] Failed to update owner plan:', dbError)
      await sendOpsAlert({
        severity: 'critical',
        type: 'billing:webhook:professional_upgrade_failed',
        title: 'Professional subscription fulfillment failed',
        message: dbError.message,
        context: {
          stripeEventId: event?.id,
          stripeSessionId: session.id,
          ownerId,
          stripeSubscriptionId: session.subscription,
        },
      })
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    await sendProfessionalActivatedEmail({ owner, appUrl: getAppUrl() })

    trackServerEvent(
      EVENT_CHECKOUT_COMPLETED,
      {
        owner_id: owner.id,
        billing_intent: intent,
        stripe_session_id: session.id,
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
      },
      { distinctId: getOwnerAnalyticsId(owner.id) }
    )

    trackServerEvent(
      EVENT_UPSELL_CONVERSION,
      {
        owner_id: owner.id,
        billing_intent: intent,
        upsell_type: session.metadata?.upsellType || intent,
        source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
        stripe_session_id: session.id,
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
      },
      { distinctId: getOwnerAnalyticsId(owner.id) }
    )

    console.log('[stripe/webhook] Owner upgraded to Professional:', owner.email)

    return {
      kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
      response: NextResponse.json({ received: true }),
    }
  }

  else {
    console.warn('[stripe/webhook] Unknown checkout intent:', intent)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:unknown_intent',
      title: 'Unknown checkout intent in Stripe webhook',
      message: `Received checkout.session.completed with intent=${intent}`,
      context: { stripeEventId: event?.id, stripeSessionId: session.id, intent },
    })
  }

  return NextResponse.json({ received: true })
}

// ── checkout.session.async_payment_succeeded ──
// Fires when a delayed/asynchronous payment method (e.g. a bank debit) that
// was still 'unpaid' at checkout.session.completed time finally settles as
// paid. Only extra_event's canonical (pendingCheckout-based) path is wired
// here — the legacy pre-migration fallback has no local row to correlate
// against and is, by construction, a decaying historical-only path.
async function handleCheckoutSessionAsyncPaymentSucceeded({ event, prisma, attempt }) {
  const session = event.data.object
  const intent = session.metadata?.intent
  const ownerId = session.metadata?.ownerId

  if (intent !== 'extra_event' || !ownerId) {
    return NextResponse.json({ received: true })
  }

  if (session.payment_status !== 'paid') {
    console.warn('[stripe/webhook] checkout.session.async_payment_succeeded without payment_status=paid, skipping')
    return NextResponse.json({ received: true })
  }

  const stripeEventId = event.id
  const postPurchaseAction = session.metadata?.postPurchaseAction

  const pendingCheckout = await prisma.extraFreeEventCheckout.findUnique({
    where: { stripeCheckoutSessionId: session.id },
  })
  if (!pendingCheckout) {
    console.warn('[stripe/webhook] async_payment_succeeded: no pending checkout found, skipping')
    return NextResponse.json({ received: true })
  }

  const finalizeInTransaction = (tx) => markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
  const fulfillmentArgs = { prisma, session, ownerId, intent, pendingCheckout, finalizeInTransaction }

  await (postPurchaseAction === 'create_event'
    ? fulfillExtraFreeEventBuyAndCreate(fulfillmentArgs)
    : fulfillExtraFreeEventCreditCanonical(fulfillmentArgs))

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── checkout.session.async_payment_failed ──
// A delayed/asynchronous payment method ultimately failed to settle. This
// is NOT the same as the existing 'failed' checkout status, which means
// "payment succeeded, auto-create failed, compensation credit granted" —
// reusing it here would corrupt that signal. No entitlement is granted, no
// local status is changed: the checkout stays 'checkout_created' so the
// customer can retry with a new checkout, or a future authoritative
// reconciliation pass can resolve any long-lived case against Stripe's own
// current state. No new terminal state is invented from this event alone.
async function handleCheckoutSessionAsyncPaymentFailed({ event }) {
  const session = event.data.object
  const intent = session.metadata?.intent

  if (intent !== 'extra_event') {
    return NextResponse.json({ received: true })
  }

  console.log('[stripe/webhook] Extra free event async payment failed — no local state change, checkout remains checkout_created')
  return NextResponse.json({ received: true })
}

// ── checkout.session.expired ──
// The Checkout Session itself reached Stripe's terminal 'expired' state
// (unpaid, permanently unpayable — a session cannot later transition to
// complete once expired). Transitions a local 'checkout_created' row to
// 'expired'; every other local status is left untouched, never downgraded.
async function handleCheckoutSessionExpired({ event, prisma, attempt }) {
  const session = event.data.object
  const intent = session.metadata?.intent

  if (intent !== 'extra_event') {
    return NextResponse.json({ received: true })
  }

  const stripeEventId = event.id

  const pendingCheckout = await prisma.extraFreeEventCheckout.findFirst({
    where: { stripeCheckoutSessionId: session.id },
  })
  if (!pendingCheckout) {
    return NextResponse.json({ received: true })
  }

  const finalizeInTransaction = (tx) => markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })
  const result = await expireExtraFreeEventCheckout({ prisma, pendingCheckout, finalizeInTransaction })

  console.log(
    `[stripe/webhook] Extra free event checkout ${pendingCheckout.id}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`,
  )

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── customer.subscription.updated ──
// Handle status changes and scheduled cancellations for Professional subscriptions
async function handleSubscriptionUpdated({ event, prisma, stripe, attempt }) {
  if (!isStripeOrderingGuardEnabled()) {
    return legacyHandleSubscriptionUpdated({ event, prisma, attempt })
  }
  return orderedHandleSubscriptionUpdated({ event, prisma, stripe, attempt })
}

// Unmodified since before STEP 5.7 — this is the exact behavior that must
// remain byte-for-behavior invariant while the ordering guard is disabled.
async function legacyHandleSubscriptionUpdated({ event, prisma, attempt }) {
  const subscription = event.data.object
  const subscriptionId = subscription.id
  const status = subscription.status
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true
  const currentPeriodEnd = subscription.current_period_end

  const owner = await prisma.owner.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  })

  if (!owner) {
    // Nothing to write, so nothing to make atomic: the wrapper's standalone
    // markStripeWebhookEventProcessed on this legacy response is already
    // correct and sufficient.
    console.warn('[stripe/webhook] Owner not found for subscription:', subscriptionId)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:subscription_owner_not_found',
      title: 'Owner not found for subscription update',
      message: `Stripe subscription ${subscriptionId} could not be matched to an owner.`,
      context: { stripeEventId: event?.id, stripeSubscriptionId: subscriptionId, status },
    })
    return NextResponse.json({ received: true })
  }

  const wasScheduled = owner.subscriptionCancelAtPeriodEnd === true
  const hadSamePeriodEnd =
    owner.subscriptionCurrentPeriodEnd &&
    currentPeriodEnd &&
    new Date(owner.subscriptionCurrentPeriodEnd).getTime() === new Date(currentPeriodEnd * 1000).getTime()

  const updateData = buildSubscriptionUpdatedData({ subscription, owner })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: owner.id }, data: updateData })
      await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
    })
  } catch (dbError) {
    if (dbError instanceof StripeWebhookFencingError) {
      // Another worker already reclaimed this delivery; Prisma already
      // rolled back the owner write above. Let the wrapper handle it
      // (503, no markFailed with this now-stale attempt).
      throw dbError
    }
    console.error('[stripe/webhook] Failed to handle subscription update:', dbError)
    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:webhook:subscription_update_failed',
      title: 'Subscription update webhook failed',
      message: dbError.message,
      context: {
        stripeEventId: event?.id,
        stripeSubscriptionId: subscriptionId,
        status,
        cancelAtPeriodEnd,
      },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  console.log(
    `[stripe/webhook] Owner ${owner.email} subscription updated (status: ${status}, plan: ${updateData.plan}, cancelAtPeriodEnd: ${cancelAtPeriodEnd})`
  )

  const appUrl = getAppUrl()

  if (cancelAtPeriodEnd && (!wasScheduled || !hadSamePeriodEnd)) {
    await sendProfessionalCancellationScheduledEmail({
      owner,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
      appUrl,
    })
  }

  if (!cancelAtPeriodEnd && wasScheduled) {
    // Reactivation: cancellation schedule was removed (e.g. via Customer Portal).
    // For V1 we only clear the dashboard state; an optional reactivation email
    // can be added later.
    console.log(`[stripe/webhook] Owner ${owner.email} cancellation schedule removed`)
  }

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── customer.subscription.deleted ──
// Professional subscription fully ended
async function handleSubscriptionDeleted({ event, prisma, stripe, attempt }) {
  if (!isStripeOrderingGuardEnabled()) {
    return legacyHandleSubscriptionDeleted({ event, prisma, attempt })
  }
  return orderedHandleSubscriptionDeleted({ event, prisma, stripe, attempt })
}

// Unmodified since before STEP 5.7 — this is the exact behavior that must
// remain byte-for-behavior invariant while the ordering guard is disabled.
async function legacyHandleSubscriptionDeleted({ event, prisma, attempt }) {
  const subscription = event.data.object
  const subscriptionId = subscription.id

  const owner = await prisma.owner.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  })

  if (!owner) {
    // Nothing to write, so nothing to make atomic: the wrapper's standalone
    // markStripeWebhookEventProcessed on this legacy response is already
    // correct and sufficient.
    console.warn('[stripe/webhook] Owner not found for deleted subscription:', subscriptionId)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:subscription_deleted_owner_not_found',
      title: 'Owner not found for subscription deletion',
      message: `Stripe subscription ${subscriptionId} could not be matched to an owner.`,
      context: { stripeEventId: event?.id, stripeSubscriptionId: subscriptionId },
    })
    return NextResponse.json({ received: true })
  }

  // Avoid duplicate cancellation emails if Stripe retries while the owner
  // is already marked as canceled.
  const wasAlreadyCanceled = owner.subscriptionStatus === 'canceled'
  const cancellationWasScheduled = owner.subscriptionCancelAtPeriodEnd === true

  try {
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: owner.id }, data: buildSubscriptionDeletedData() })
      await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
    })
  } catch (dbError) {
    if (dbError instanceof StripeWebhookFencingError) {
      throw dbError
    }
    console.error('[stripe/webhook] Failed to handle subscription deletion:', dbError)
    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:webhook:subscription_deletion_failed',
      title: 'Subscription deletion webhook failed',
      message: dbError.message,
      context: { stripeEventId: event?.id, stripeSubscriptionId: subscriptionId },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  // If the user canceled at period end, the scheduled-cancellation email was
  // already sent when cancel_at_period_end became true. Send the final
  // cancellation email only for immediate cancellations or legacy cases.
  if (!wasAlreadyCanceled && !cancellationWasScheduled) {
    await sendProfessionalCanceledEmail({ owner, appUrl: getAppUrl() })
  }

  console.log('[stripe/webhook] Owner downgraded to free after subscription deletion:', owner.email)

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── STEP 5.7: subscription-domain ordering (guard-gated) ──
//
// Resolves the Owner for a subscription-domain event, classifying the
// identity relationship between the event's subscription id and the
// owner's billing scope:
//   FOUND         — normal: owner's stripeSubscriptionId matches directly,
//                   or the owner's scope still points at this (possibly
//                   already-tombstoned, stripeSubscriptionId-nulled)
//                   subscription — lets trailing events for an already
//                   terminal subscription still resolve to their owner so
//                   the marker (not a blanket "not found") can classify
//                   them as stale.
//   RACE          — no direct/scope match, but Stripe's own
//                   subscription_data.metadata.ownerId (embedded at
//                   Checkout creation, STEP 5.1b finding) resolves to a
//                   real owner whose scope is still null — a plausible
//                   pre-checkout / not-yet-linked race. Retryable.
//   SCOPE_MISMATCH — owner found by direct stripeSubscriptionId match but
//                   its scope points at a third, different subscription.
//                   Not reachable under the write invariants established
//                   in STEP 5.1b/5.3b/5.5/5.6; handled conservatively.
//   NOT_FOUND     — no correlation at all, or a metadata match whose scope
//                   already points at a different, established
//                   subscription (genuinely stale/foreign, not a race).
async function resolveSubscriptionEventOwner({ prisma, eventSubscriptionId, metadataOwnerId }) {
  let owner = await prisma.owner.findFirst({ where: { stripeSubscriptionId: eventSubscriptionId } })

  if (!owner) {
    owner = await prisma.owner.findFirst({ where: { stripeBillingCursorSubscriptionId: eventSubscriptionId } })
  }

  if (owner) {
    const scope = owner.stripeBillingCursorSubscriptionId
    if (scope === null || scope === eventSubscriptionId) {
      return { classification: 'FOUND', owner }
    }
    return { classification: 'SCOPE_MISMATCH', owner: null }
  }

  if (metadataOwnerId) {
    const candidateOwner = await prisma.owner.findUnique({ where: { id: metadataOwnerId } })
    if (candidateOwner && candidateOwner.stripeBillingCursorSubscriptionId === null) {
      return { classification: 'RACE', owner: candidateOwner }
    }
  }

  return { classification: 'NOT_FOUND', owner: null }
}

const SUBSCRIPTION_ORDERING_MAX_CAS_RETRIES = 5

// Shared recency/CAS engine for both customer.subscription.updated and
// .deleted once identity + bootstrap have already been resolved.
//
// `buildNewerUpdate(owner)` — sync, no Stripe call: the fast path business
//   update for an unambiguously newer event (mirrors legacy behavior, which
//   never retrieves canonical state for this case either).
// The same-second tie always does its own canonical retrieve inline below —
// it's identical for both event types, so it isn't parametrized.
// `afterNewerCommit(preOwner, postOwner)` — best-effort side effects (the
//   existing legacy emails), fired only after a successful newer-path
//   commit — never for bootstrap, stale, same-second, or a CAS-miss retry.
async function applySubscriptionOrderedUpdate({
  event, prisma, stripe, attempt, owner, eventSubscriptionId,
  buildNewerUpdate, afterNewerCommit,
}) {
  const incoming = BigInt(event.created)

  for (let i = 0; i < SUBSCRIPTION_ORDERING_MAX_CAS_RETRIES; i++) {
    const scope = owner.stripeBillingCursorSubscriptionId
    if (scope !== eventSubscriptionId) {
      // Scope moved out from under us between our read and now (e.g. a
      // concurrent resubscribe). Defer to identity policy: no write.
      return NextResponse.json({ received: true })
    }

    const current = owner.lastStripeSubscriptionEventCreated

    if (incoming < current) {
      return NextResponse.json({ received: true, stale: true })
    }

    if (incoming === current) {
      // Same-second tie: event.created cannot order these two events.
      // event.id is never used as a tie-break — canonical Stripe state is
      // authority instead.
      const subscription = await stripe.subscriptions.retrieve(eventSubscriptionId)
      const update = buildSubscriptionUpdatedData({ subscription, owner })
      await prisma.$transaction(async (tx) => {
        await tx.owner.update({
          where: { id: owner.id },
          data: {
            ...update,
            stripeBillingCursorSubscriptionId: eventSubscriptionId,
            lastStripeSubscriptionEventCreated: incoming,
          },
        })
        await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
      })
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }

    // incoming > current: unambiguously newer. Atomic CAS, guarded on the
    // exact scope + marker generation we just observed.
    const preOwner = owner
    const update = buildNewerUpdate(owner)
    let casCount = 0
    await prisma.$transaction(async (tx) => {
      const result = await tx.owner.updateMany({
        where: {
          id: owner.id,
          stripeBillingCursorSubscriptionId: eventSubscriptionId,
          lastStripeSubscriptionEventCreated: current,
        },
        data: {
          ...update,
          stripeBillingCursorSubscriptionId: eventSubscriptionId,
          lastStripeSubscriptionEventCreated: incoming,
        },
      })
      casCount = result.count
      if (casCount === 1) {
        await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
      }
    })

    if (casCount === 1) {
      const postOwner = await prisma.owner.findUnique({ where: { id: owner.id } })
      if (afterNewerCommit) await afterNewerCommit(preOwner, postOwner)
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }

    // count === 0: a concurrent writer advanced (or moved) the cursor
    // between our read and this CAS attempt. No blind fallback — re-read
    // and re-classify from scratch on the next loop iteration.
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  throw new Error(
    `stripe-webhook: exceeded ${SUBSCRIPTION_ORDERING_MAX_CAS_RETRIES} CAS retries for subscription ordering on ${eventSubscriptionId}`
  )
}

async function orderedHandleSubscriptionUpdated({ event, prisma, stripe, attempt }) {
  const subscription = event.data.object
  const eventSubscriptionId = subscription.id
  const status = subscription.status
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true

  const resolved = await resolveSubscriptionEventOwner({
    prisma,
    eventSubscriptionId,
    metadataOwnerId: subscription.metadata?.ownerId,
  })

  if (resolved.classification === 'RACE') {
    console.warn('[stripe/webhook] Possible pre-checkout race for subscription update:', {
      eventSubscriptionId,
      ownerId: resolved.owner.id,
    })
    return NextResponse.json(
      { received: false, code: 'possible_pre_checkout_race' },
      { status: 503, headers: { 'Retry-After': '5' } }
    )
  }

  if (resolved.classification === 'NOT_FOUND' || resolved.classification === 'SCOPE_MISMATCH') {
    console.warn('[stripe/webhook] Owner not found for subscription (ordering guard):', eventSubscriptionId)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:subscription_owner_not_found',
      title: 'Owner not found for subscription update',
      message: `Stripe subscription ${eventSubscriptionId} could not be matched to an owner.`,
      context: { stripeEventId: event?.id, stripeSubscriptionId: eventSubscriptionId, status },
    })
    return NextResponse.json({ received: true })
  }

  let owner = resolved.owner

  if (owner.lastStripeSubscriptionEventCreated === null || owner.lastStripeSubscriptionEventCreated === undefined) {
    const bootstrapResult = await bootstrapStripeSubscriptionOrdering({
      stripe, prisma, owner, stripeEvent: event, attempt,
    })
    if (bootstrapResult.action === 'BOOTSTRAPPED') {
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }
    // ALREADY_BOOTSTRAPPED: another delivery bootstrapped between our read
    // and now. Never continue on the stale snapshot — refresh from the DB.
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  return applySubscriptionOrderedUpdate({
    event, prisma, stripe, attempt, owner, eventSubscriptionId,
    buildNewerUpdate: (currentOwner) => buildSubscriptionUpdatedData({ subscription, owner: currentOwner }),
    afterNewerCommit: async (preOwner, postOwner) => {
      const currentPeriodEnd = subscription.current_period_end
      const wasScheduled = preOwner.subscriptionCancelAtPeriodEnd === true
      const hadSamePeriodEnd =
        preOwner.subscriptionCurrentPeriodEnd &&
        currentPeriodEnd &&
        new Date(preOwner.subscriptionCurrentPeriodEnd).getTime() === new Date(currentPeriodEnd * 1000).getTime()

      console.log(
        `[stripe/webhook] Owner ${postOwner.email} subscription updated (status: ${status}, plan: ${postOwner.plan}, cancelAtPeriodEnd: ${cancelAtPeriodEnd})`
      )

      const appUrl = getAppUrl()
      if (cancelAtPeriodEnd && (!wasScheduled || !hadSamePeriodEnd)) {
        await sendProfessionalCancellationScheduledEmail({
          owner: postOwner,
          currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
          appUrl,
        })
      }
      if (!cancelAtPeriodEnd && wasScheduled) {
        console.log(`[stripe/webhook] Owner ${postOwner.email} cancellation schedule removed`)
      }
    },
  })
}

async function orderedHandleSubscriptionDeleted({ event, prisma, stripe, attempt }) {
  const subscription = event.data.object
  const eventSubscriptionId = subscription.id

  const resolved = await resolveSubscriptionEventOwner({
    prisma,
    eventSubscriptionId,
    metadataOwnerId: subscription.metadata?.ownerId,
  })

  if (resolved.classification === 'RACE') {
    console.warn('[stripe/webhook] Possible pre-checkout race for subscription deletion:', {
      eventSubscriptionId,
      ownerId: resolved.owner.id,
    })
    return NextResponse.json(
      { received: false, code: 'possible_pre_checkout_race' },
      { status: 503, headers: { 'Retry-After': '5' } }
    )
  }

  if (resolved.classification === 'NOT_FOUND' || resolved.classification === 'SCOPE_MISMATCH') {
    console.warn('[stripe/webhook] Owner not found for deleted subscription (ordering guard):', eventSubscriptionId)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:subscription_deleted_owner_not_found',
      title: 'Owner not found for subscription deletion',
      message: `Stripe subscription ${eventSubscriptionId} could not be matched to an owner.`,
      context: { stripeEventId: event?.id, stripeSubscriptionId: eventSubscriptionId },
    })
    return NextResponse.json({ received: true })
  }

  let owner = resolved.owner

  if (owner.lastStripeSubscriptionEventCreated === null || owner.lastStripeSubscriptionEventCreated === undefined) {
    const bootstrapResult = await bootstrapStripeSubscriptionOrdering({
      stripe, prisma, owner, stripeEvent: event, attempt,
    })
    if (bootstrapResult.action === 'BOOTSTRAPPED') {
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  return applySubscriptionOrderedUpdate({
    event, prisma, stripe, attempt, owner, eventSubscriptionId,
    buildNewerUpdate: () => buildSubscriptionDeletedData(),
    afterNewerCommit: async (preOwner, postOwner) => {
      const wasAlreadyCanceled = preOwner.subscriptionStatus === 'canceled'
      const cancellationWasScheduled = preOwner.subscriptionCancelAtPeriodEnd === true
      if (!wasAlreadyCanceled && !cancellationWasScheduled) {
        await sendProfessionalCanceledEmail({ owner: postOwner, appUrl: getAppUrl() })
      }
      console.log('[stripe/webhook] Owner downgraded to free after subscription deletion:', postOwner.email)
    },
  })
}

// ── invoice.payment_failed ──
// Professional payment failed: enter past_due with a grace period.
async function handleInvoicePaymentFailed({ event, prisma, stripe, attempt }) {
  if (!isStripeOrderingGuardEnabled()) {
    return legacyHandleInvoicePaymentFailed({ event, prisma, attempt })
  }
  return orderedHandleInvoicePaymentFailed({ event, prisma, stripe, attempt })
}

// Unmodified since before STEP 5.8 — this is the exact behavior that must
// remain byte-for-behavior invariant while the ordering guard is disabled.
async function legacyHandleInvoicePaymentFailed({ event, prisma, attempt }) {
  const invoice = event.data.object
  const subscriptionId = invoice.subscription
  const customerId = invoice.customer

  const owner = await prisma.owner.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: subscriptionId || '' },
        { stripeCustomerId: customerId || '' },
      ],
    },
  })

  if (!owner) {
    // Nothing to write, so nothing to make atomic: the wrapper's standalone
    // markStripeWebhookEventProcessed on this legacy response is already
    // correct and sufficient.
    console.warn('[stripe/webhook] Owner not found for failed invoice:', { subscriptionId, customerId })
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:invoice_failed_owner_not_found',
      title: 'Owner not found for invoice.payment_failed',
      message: `Could not match failed invoice to an owner.`,
      context: { stripeEventId: event?.id, stripeInvoiceId: invoice.id, subscriptionId, customerId },
    })
    return NextResponse.json({ received: true })
  }

  // Idempotency: skip if we already recorded this exact invoice as failed.
  // Key on invoice ID + paymentFailedAt so retries are deduplicated even if
  // subscriptionStatus has changed in the meantime. Same standalone-
  // finalization reasoning: no write happens on this path.
  if (isPaymentFailureAlreadyHandled(owner, invoice)) {
    console.log(`[stripe/webhook] Failed invoice ${invoice.id} already recorded for owner ${owner.email}`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  const updateData = buildPaymentFailedUpdate(invoice)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: owner.id }, data: updateData })
      await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
    })
  } catch (dbError) {
    if (dbError instanceof StripeWebhookFencingError) {
      // Another worker already reclaimed this delivery; Prisma already
      // rolled back the owner write above. Let the wrapper handle it
      // (503, no markFailed with this now-stale attempt).
      throw dbError
    }
    console.error('[stripe/webhook] Failed to handle payment failure:', dbError)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:payment_failure_handling_failed',
      title: 'Failed to record invoice.payment_failed',
      message: dbError.message,
      context: {
        stripeEventId: event?.id,
        stripeInvoiceId: invoice.id,
        subscriptionId,
        customerId,
      },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  const access = resolveSubscriptionAccessState({ ...owner, ...updateData })
  console.log(
    `[stripe/webhook] Owner ${owner.email} payment failed (invoice: ${invoice.id}, grace active: ${access.graceActive})`
  )

  await sendProfessionalPaymentFailedEmail({ owner, billingState: access, appUrl: getAppUrl() })

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── invoice.payment_succeeded ──
// Subscription payment recovered: restore active state.
async function handleInvoicePaymentSucceeded({ event, prisma, stripe, attempt }) {
  if (!isStripeOrderingGuardEnabled()) {
    return legacyHandleInvoicePaymentSucceeded({ event, prisma, attempt })
  }
  return orderedHandleInvoicePaymentSucceeded({ event, prisma, stripe, attempt })
}

// Unmodified since before STEP 5.8 — this is the exact behavior that must
// remain byte-for-behavior invariant while the ordering guard is disabled.
async function legacyHandleInvoicePaymentSucceeded({ event, prisma, attempt }) {
  const invoice = event.data.object
  const subscriptionId = invoice.subscription
  const customerId = invoice.customer

  // Only handle subscription invoices, not one-time event upgrades. Nothing
  // to write, so nothing to make atomic.
  if (!subscriptionId) {
    return NextResponse.json({ received: true })
  }

  const owner = await prisma.owner.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: subscriptionId || '' },
        { stripeCustomerId: customerId || '' },
      ],
    },
  })

  if (!owner) {
    console.warn('[stripe/webhook] Owner not found for successful invoice:', { subscriptionId, customerId })
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:invoice_succeeded_owner_not_found',
      title: 'Owner not found for invoice.payment_succeeded',
      message: `Could not match successful subscription invoice to an owner.`,
      context: { stripeEventId: event?.id, stripeInvoiceId: invoice.id, subscriptionId, customerId },
    })
    return NextResponse.json({ received: true })
  }

  // Only send a "payment recovered" email when this success resolves a
  // previous failure or past_due/unpaid state. Normal monthly renewals
  // should stay silent.
  const wasRecoverable =
    !!owner.paymentFailedAt ||
    owner.subscriptionStatus === 'past_due' ||
    owner.subscriptionStatus === 'unpaid'

  try {
    await prisma.$transaction(async (tx) => {
      await tx.owner.update({ where: { id: owner.id }, data: buildPaymentSucceededUpdate(invoice) })
      await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
    })
  } catch (dbError) {
    if (dbError instanceof StripeWebhookFencingError) {
      throw dbError
    }
    console.error('[stripe/webhook] Failed to handle payment success:', dbError)
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:payment_success_handling_failed',
      title: 'Failed to record invoice.payment_succeeded',
      message: dbError.message,
      context: {
        stripeEventId: event?.id,
        stripeInvoiceId: invoice.id,
        subscriptionId,
        customerId,
      },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  if (wasRecoverable) {
    await sendProfessionalPaymentRecoveredEmail({ owner, appUrl: getAppUrl() })
  }

  console.log('[stripe/webhook] Owner payment succeeded, subscription restored:', owner.email)

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}

// ── STEP 5.8: invoice-domain ordering (guard-gated) ──
//
// Discovery vs. authorization (item 3): the existing OR(stripeSubscriptionId,
// stripeCustomerId) lookup is kept for *finding* a candidate owner — a
// customer can have many historical subscriptions — but stripeCustomerId
// never *authorizes* a write on its own. Authorization requires the
// owner's scope to already equal invoiceSubscriptionId, or (the one-time
// legacy bootstrap exception) scope to be null with stripeSubscriptionId
// matching directly.
//   AUTHORIZED       — case A (scope matches) or case B (never-bootstrapped
//                       legacy owner, direct subscriptionId match).
//   STALE_OR_FOREIGN — case C (scope points elsewhere) or case D (only a
//                       customerId match, scope null, subscriptionId
//                       doesn't match) — always a terminal no-op, never
//                       retryable. No metadata.ownerId-equivalent
//                       correlation exists for invoices (STEP 5.3b finding:
//                       Invoice objects don't inherit Subscription
//                       metadata), so no pre-checkout race policy here.
//   NOT_FOUND         — no owner correlates at all (same as legacy).
async function resolveInvoiceEventOwner({ prisma, invoiceSubscriptionId, customerId }) {
  const owner = await prisma.owner.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: invoiceSubscriptionId || '' },
        { stripeCustomerId: customerId || '' },
      ],
    },
  })

  if (!owner) {
    return { classification: 'NOT_FOUND', owner: null }
  }

  const scope = owner.stripeBillingCursorSubscriptionId
  if (scope === invoiceSubscriptionId) {
    return { classification: 'AUTHORIZED', owner }
  }
  if (scope === null && owner.stripeSubscriptionId === invoiceSubscriptionId) {
    return { classification: 'AUTHORIZED', owner }
  }

  return { classification: 'STALE_OR_FOREIGN', owner: null }
}

const INVOICE_ORDERING_MAX_CAS_RETRIES = 5

// Shared recency/CAS engine for both invoice.payment_failed and
// .payment_succeeded once identity + bootstrap have already been resolved.
// Never writes stripeBillingCursorSubscriptionId — invoice ordering only
// ever operates *within* an already-established scope; it never sets or
// advances it (that is exclusively checkout/subscription-domain's job).
async function applyInvoiceOrderedUpdate({
  event, prisma, stripe, attempt, owner, invoiceSubscriptionId,
  buildNewerUpdate, afterNewerCommit,
}) {
  const incoming = BigInt(event.created)

  for (let i = 0; i < INVOICE_ORDERING_MAX_CAS_RETRIES; i++) {
    const scope = owner.stripeBillingCursorSubscriptionId
    if (scope !== invoiceSubscriptionId) {
      return NextResponse.json({ received: true })
    }

    const current = owner.lastStripeInvoiceEventCreated

    if (incoming < current) {
      return NextResponse.json({ received: true, stale: true })
    }

    if (incoming === current) {
      // Same-second tie: never apply the incoming payload directly.
      // Canonical Stripe state (via latest_invoice) is authority — event.id
      // is never used as a tie-break.
      const subscription = await stripe.subscriptions.retrieve(invoiceSubscriptionId, { expand: ['latest_invoice'] })
      const latestInvoice = subscription.latest_invoice
      const update = {
        lastInvoiceId: latestInvoice?.id ?? null,
        lastInvoiceStatus: latestInvoice?.status ?? null,
      }
      if (latestInvoice?.status === 'paid') {
        update.paymentFailedAt = null
        update.lastPaymentError = null
      }
      // Any other status: preserve the existing paymentFailedAt/lastPaymentError
      // (not included in `update` at all) — cannot be reconstructed with
      // certainty (STEP 5.3b finding).
      await prisma.$transaction(async (tx) => {
        await tx.owner.update({
          where: { id: owner.id },
          data: { ...update, lastStripeInvoiceEventCreated: incoming },
        })
        await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
      })
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }

    // incoming > current: unambiguously newer. Atomic CAS, guarded on the
    // exact scope + marker generation we just observed.
    const preOwner = owner
    const update = buildNewerUpdate()
    let casCount = 0
    await prisma.$transaction(async (tx) => {
      const result = await tx.owner.updateMany({
        where: {
          id: owner.id,
          stripeBillingCursorSubscriptionId: invoiceSubscriptionId,
          lastStripeInvoiceEventCreated: current,
        },
        data: { ...update, lastStripeInvoiceEventCreated: incoming },
      })
      casCount = result.count
      if (casCount === 1) {
        await markStripeWebhookEventProcessed({ prisma: tx, eventId: event.id, attempt })
      }
    })

    if (casCount === 1) {
      const postOwner = await prisma.owner.findUnique({ where: { id: owner.id } })
      if (afterNewerCommit) await afterNewerCommit(preOwner, postOwner)
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }

    // count === 0: a concurrent writer advanced (or moved) the cursor
    // between our read and this CAS attempt. No blind fallback — re-read
    // and re-classify from scratch on the next loop iteration.
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  throw new Error(
    `stripe-webhook: exceeded ${INVOICE_ORDERING_MAX_CAS_RETRIES} CAS retries for invoice ordering on ${invoiceSubscriptionId}`
  )
}

async function orderedHandleInvoicePaymentFailed({ event, prisma, stripe, attempt }) {
  const invoice = event.data.object
  const invoiceSubscriptionId = invoice.subscription
  const customerId = invoice.customer

  if (!invoiceSubscriptionId) {
    // No subscription to establish ordering identity against — do not
    // invent one (item 2). Safe no-op.
    return NextResponse.json({ received: true })
  }

  const resolved = await resolveInvoiceEventOwner({ prisma, invoiceSubscriptionId, customerId })

  if (resolved.classification === 'NOT_FOUND') {
    console.warn('[stripe/webhook] Owner not found for failed invoice (ordering guard):', { invoiceSubscriptionId, customerId })
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:invoice_failed_owner_not_found',
      title: 'Owner not found for invoice.payment_failed',
      message: `Could not match failed invoice to an owner.`,
      context: { stripeEventId: event?.id, stripeInvoiceId: invoice.id, invoiceSubscriptionId, customerId },
    })
    return NextResponse.json({ received: true })
  }

  if (resolved.classification === 'STALE_OR_FOREIGN') {
    console.warn('[stripe/webhook] Failed invoice references a subscription outside the owner scope (ordering guard):', { invoiceSubscriptionId })
    return NextResponse.json({ received: true })
  }

  let owner = resolved.owner

  // Idempotency: same standalone-finalization reasoning as legacy — no
  // write happens on this path, orthogonal to the ordering marker.
  if (isPaymentFailureAlreadyHandled(owner, invoice)) {
    console.log(`[stripe/webhook] Failed invoice ${invoice.id} already recorded for owner ${owner.email}`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  if (owner.lastStripeInvoiceEventCreated === null || owner.lastStripeInvoiceEventCreated === undefined) {
    const bootstrapResult = await bootstrapStripeInvoiceOrdering({
      stripe, prisma, owner, stripeEvent: event, attempt,
    })
    if (bootstrapResult.action === 'BOOTSTRAPPED') {
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }
    // ALREADY_BOOTSTRAPPED: refresh from the DB, never continue on the
    // stale null-marker snapshot.
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  return applyInvoiceOrderedUpdate({
    event, prisma, stripe, attempt, owner, invoiceSubscriptionId,
    buildNewerUpdate: () => buildPaymentFailedUpdate(invoice),
    afterNewerCommit: async (preOwner, postOwner) => {
      const access = resolveSubscriptionAccessState(postOwner)
      console.log(
        `[stripe/webhook] Owner ${postOwner.email} payment failed (invoice: ${invoice.id}, grace active: ${access.graceActive})`
      )
      await sendProfessionalPaymentFailedEmail({ owner: postOwner, billingState: access, appUrl: getAppUrl() })
    },
  })
}

async function orderedHandleInvoicePaymentSucceeded({ event, prisma, stripe, attempt }) {
  const invoice = event.data.object
  const invoiceSubscriptionId = invoice.subscription
  const customerId = invoice.customer

  if (!invoiceSubscriptionId) {
    return NextResponse.json({ received: true })
  }

  const resolved = await resolveInvoiceEventOwner({ prisma, invoiceSubscriptionId, customerId })

  if (resolved.classification === 'NOT_FOUND') {
    console.warn('[stripe/webhook] Owner not found for successful invoice (ordering guard):', { invoiceSubscriptionId, customerId })
    await sendOpsAlert({
      severity: 'warning',
      type: 'billing:webhook:invoice_succeeded_owner_not_found',
      title: 'Owner not found for invoice.payment_succeeded',
      message: `Could not match successful subscription invoice to an owner.`,
      context: { stripeEventId: event?.id, stripeInvoiceId: invoice.id, invoiceSubscriptionId, customerId },
    })
    return NextResponse.json({ received: true })
  }

  if (resolved.classification === 'STALE_OR_FOREIGN') {
    console.warn('[stripe/webhook] Successful invoice references a subscription outside the owner scope (ordering guard):', { invoiceSubscriptionId })
    return NextResponse.json({ received: true })
  }

  let owner = resolved.owner

  if (owner.lastStripeInvoiceEventCreated === null || owner.lastStripeInvoiceEventCreated === undefined) {
    const bootstrapResult = await bootstrapStripeInvoiceOrdering({
      stripe, prisma, owner, stripeEvent: event, attempt,
    })
    if (bootstrapResult.action === 'BOOTSTRAPPED') {
      return {
        kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
        response: NextResponse.json({ received: true }),
      }
    }
    owner = await prisma.owner.findUnique({ where: { id: owner.id } })
  }

  return applyInvoiceOrderedUpdate({
    event, prisma, stripe, attempt, owner, invoiceSubscriptionId,
    buildNewerUpdate: () => buildPaymentSucceededUpdate(invoice),
    afterNewerCommit: async (preOwner, postOwner) => {
      // Same "only notify on genuine recovery" semantics as legacy,
      // computed from the pre-update owner snapshot.
      const wasRecoverable =
        !!preOwner.paymentFailedAt ||
        preOwner.subscriptionStatus === 'past_due' ||
        preOwner.subscriptionStatus === 'unpaid'
      console.log('[stripe/webhook] Owner payment succeeded, subscription restored (ordering guard):', postOwner.email)
      if (wasRecoverable) {
        await sendProfessionalPaymentRecoveredEmail({ owner: postOwner, appUrl: getAppUrl() })
      }
    },
  })
}

// ── Helper: Extra Free Event credit fulfillment (legacy path, atomic —
// sessions created before the pending-row migration, no pendingCheckout row) ──
async function fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent, stripeEventId, attempt }) {
  const existing = await prisma.owner.findFirst({
    where: { id: ownerId, extraEventCheckoutSessionId: session.id },
  })
  if (existing) {
    console.log(`[stripe/webhook] Owner ${existing.email} already fulfilled for extra free event session ${session.id}`)
    return NextResponse.json({ received: true })
  }

  let updatedOwner
  try {
    updatedOwner = await prisma.$transaction(async (tx) => {
      const owner = await tx.owner.update({
        where: { id: ownerId },
        data: {
          extraEventCredits: { increment: 1 },
          extraEventCheckoutSessionId: session.id,
          updatedAt: new Date(),
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

      await markStripeWebhookEventProcessed({ prisma: tx, eventId: stripeEventId, attempt })

      return owner
    })
  } catch (dbError) {
    if (dbError instanceof StripeWebhookFencingError) {
      // Another worker already reclaimed this delivery; Prisma already
      // rolled back the credit/marker/UpsellEvent writes above. Let the
      // wrapper handle it (503, no markFailed with this now-stale attempt).
      throw dbError
    }
    if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
      console.warn('[stripe/webhook] Owner not found for extra free event fulfillment, skipping:', ownerId)
      return NextResponse.json({ received: true })
    }
    console.error('[stripe/webhook] Failed to grant extra free event credit:', dbError)
    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:extra_free_event:credit_grant_failed',
      title: 'Extra Free Event credit grant failed',
      message: dbError.message,
      context: {
        stripeSessionId: session.id,
        ownerId,
        pendingCheckoutId: undefined,
      },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
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
      extra_event_credits: updatedOwner.extraEventCredits,
    },
    { distinctId: getOwnerAnalyticsId(ownerId) }
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
    { distinctId: getOwnerAnalyticsId(ownerId) }
  )

  console.log(`[stripe/webhook] Owner ${updatedOwner.email} granted extra free event credit. Total credits: ${updatedOwner.extraEventCredits}`)

  await sendExtraFreeEventCreditGrantedEmail({
    owner: updatedOwner,
    credits: updatedOwner.extraEventCredits,
    appUrl: getAppUrl(),
  })

  return {
    kind: StripeWebhookRunOutcome.RECEIPT_ALREADY_FINALIZED,
    response: NextResponse.json({ received: true }),
  }
}
