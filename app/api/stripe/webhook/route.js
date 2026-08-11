import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
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

export const dynamic = 'force-dynamic'

// The only Stripe event types this endpoint acts on. Anything else is
// acknowledged with 200 and never gets a durable receipt — there is no
// business action to protect, so claiming it would just grow the table.
const HANDLED_STRIPE_EVENT_TYPES = new Set([
  'checkout.session.completed',
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
      run: () => handleCheckoutSessionCompleted({ event, prisma }),
    })
  }

  if (event.type === 'customer.subscription.updated') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleSubscriptionUpdated({ event, prisma, attempt: processingAttempt }),
    })
  }

  if (event.type === 'customer.subscription.deleted') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleSubscriptionDeleted({ event, prisma, attempt: processingAttempt }),
    })
  }

  if (event.type === 'invoice.payment_failed') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleInvoicePaymentFailed({ event, prisma }),
    })
  }

  if (event.type === 'invoice.payment_succeeded') {
    return processClaimedStripeWebhookEvent({
      prisma,
      eventId: stripeEventId,
      attempt: processingAttempt,
      run: () => handleInvoicePaymentSucceeded({ event, prisma }),
    })
  }
}

// ── checkout.session.completed ──
async function handleCheckoutSessionCompleted({ event, prisma }) {
  const session = event.data.object
  const intent = session.metadata?.intent
  const ownerId = session.metadata?.ownerId
  const eventId = session.metadata?.eventId

  // ── High-quality download unlock (guest or owner, no auth required) ──
  if (intent === 'high_quality_download') {
    if (!eventId) {
      console.warn('[stripe/webhook] Missing eventId for high_quality_download')
      return NextResponse.json({ received: true })
    }

    try {
      const existing = await prisma.event.findFirst({
        where: { id: eventId, originalDownloadCheckoutSessionId: session.id },
      })
      if (existing) {
        console.log(`[stripe/webhook] Event ${existing.slug} already fulfilled for download unlock session ${session.id}`)
        return NextResponse.json({ received: true })
      }

      const updatedEvent = await prisma.event.update({
        where: { id: eventId },
        data: {
          originalDownloadUnlocked: true,
          originalDownloadCheckoutSessionId: session.id,
          updatedAt: new Date(),
        },
      })

      trackServerEvent(
        EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED,
        {
          billing_intent: intent,
          event_id: eventId,
          room_slug: session.metadata?.roomSlug || null,
          stripe_session_id: session.id,
          stripe_customer_id: session.customer,
        },
        { distinctId: session.customer_email || session.customer || eventId }
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
        { distinctId: session.customer_email || session.customer || eventId }
      )

      await prisma.upsellEvent.create({
        data: {
          eventName: EVENT_UPSELL_CONVERSION,
          upsellType: session.metadata?.upsellType || 'original_quality_unlock',
          source: session.metadata?.upsellSource || 'lightbox',
          ctaPlan: 'unlock',
          eventId: eventId || null,
          eventSlug: session.metadata?.roomSlug || null,
        },
      })

      console.log(`[stripe/webhook] Event ${updatedEvent.slug} unlocked for original quality downloads`)
    } catch (dbError) {
      if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
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

    return NextResponse.json({ received: true })
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

    // New canonical path: every extra_event checkout has a unique pending row.
    const pendingCheckout = await prisma.extraFreeEventCheckout.findUnique({
      where: { stripeCheckoutSessionId: session.id },
    })

    if (pendingCheckout) {
      if (postPurchaseAction === 'create_event') {
        return await fulfillExtraFreeEventBuyAndCreate({ prisma, session, ownerId, intent })
      }
      return await fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent, pendingCheckout })
    }

    // Legacy fallback: sessions created before the pending-row migration.
    return await fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent })
  }

  // ── Event-based one-time purchase ──
  if (intent === 'pro_event' || intent === 'wedding_pro') {
    if (!eventId) {
      console.warn('[stripe/webhook] Missing eventId for event-based purchase:', intent)
      return NextResponse.json({ received: true })
    }

    try {
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

      const updatedEvent = await prisma.event.update({
        where: { id: eventId },
        data: {
          billingTier: intent,
          stripeCheckoutSessionId: session.id,
          billingPurchasedAt: new Date(),
        },
      })

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
        { distinctId: session.metadata?.ownerEmail || ownerId }
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
        { distinctId: session.metadata?.ownerEmail || ownerId }
      )

      await prisma.upsellEvent.create({
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

      console.log(`[stripe/webhook] Event ${updatedEvent.slug} upgraded to ${intent}`)
    } catch (dbError) {
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
  }

  // ── Account-level recurring subscription ──
  else if (intent === 'professional') {
    try {
      // Idempotency: skip if this exact session already fulfilled
      const existing = await prisma.owner.findFirst({
        where: { id: ownerId, stripeCheckoutSessionId: session.id },
      })
      if (existing) {
        console.log(`[stripe/webhook] Owner ${existing.email} already fulfilled for session ${session.id}`)
        return NextResponse.json({ received: true })
      }

      const owner = await prisma.owner.update({
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
        },
      })

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
        { distinctId: owner.email }
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
        { distinctId: owner.email }
      )

      await prisma.upsellEvent.create({
        data: {
          eventName: EVENT_UPSELL_CONVERSION,
          upsellType: session.metadata?.upsellType || intent,
          source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
          ctaPlan: intent,
          ownerId: owner.id,
        },
      })

      console.log('[stripe/webhook] Owner upgraded to Professional:', owner.email)
    } catch (dbError) {
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

// ── customer.subscription.updated ──
// Handle status changes and scheduled cancellations for Professional subscriptions
async function handleSubscriptionUpdated({ event, prisma, attempt }) {
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
async function handleSubscriptionDeleted({ event, prisma, attempt }) {
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

// ── invoice.payment_failed ──
// Professional payment failed: enter past_due with a grace period.
async function handleInvoicePaymentFailed({ event, prisma }) {
  const invoice = event.data.object
  const subscriptionId = invoice.subscription
  const customerId = invoice.customer

  try {
    const owner = await prisma.owner.findFirst({
      where: {
        OR: [
          { stripeSubscriptionId: subscriptionId || '' },
          { stripeCustomerId: customerId || '' },
        ],
      },
    })

    if (!owner) {
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
    // subscriptionStatus has changed in the meantime.
    if (isPaymentFailureAlreadyHandled(owner, invoice)) {
      console.log(`[stripe/webhook] Failed invoice ${invoice.id} already recorded for owner ${owner.email}`)
      return NextResponse.json({ received: true, duplicate: true })
    }

    const updateData = buildPaymentFailedUpdate(invoice)
    await prisma.owner.update({
      where: { id: owner.id },
      data: updateData,
    })

    const access = resolveSubscriptionAccessState({ ...owner, ...updateData })
    console.log(
      `[stripe/webhook] Owner ${owner.email} payment failed (invoice: ${invoice.id}, grace active: ${access.graceActive})`
    )

    await sendProfessionalPaymentFailedEmail({ owner, billingState: access, appUrl: getAppUrl() })
  } catch (dbError) {
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

  return NextResponse.json({ received: true })
}

// ── invoice.payment_succeeded ──
// Subscription payment recovered: restore active state.
async function handleInvoicePaymentSucceeded({ event, prisma }) {
  const invoice = event.data.object
  const subscriptionId = invoice.subscription
  const customerId = invoice.customer

  // Only handle subscription invoices, not one-time event upgrades.
  if (!subscriptionId) {
    return NextResponse.json({ received: true })
  }

  try {
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

    await prisma.owner.update({
      where: { id: owner.id },
      data: buildPaymentSucceededUpdate(invoice),
    })

    if (wasRecoverable) {
      await sendProfessionalPaymentRecoveredEmail({ owner, appUrl: getAppUrl() })
    }

    console.log('[stripe/webhook] Owner payment succeeded, subscription restored:', owner.email)
  } catch (dbError) {
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

  return NextResponse.json({ received: true })
}

// ── Helper: Extra Free Event credit fulfillment ──
async function fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent, pendingCheckout = null }) {
  try {
    let updatedOwner

    if (pendingCheckout) {
      // Canonical path: every extra_event checkout has a unique pending row.
      if (['credit_granted', 'auto_created', 'failed'].includes(pendingCheckout.status)) {
        console.log(
          `[stripe/webhook] Extra free event checkout ${pendingCheckout.id} already processed (status=${pendingCheckout.status}), skipping`
        )
        return NextResponse.json({ received: true })
      }

      const result = await prisma.$transaction(async (tx) => {
        // Pessimistic lock: serialize concurrent webhook deliveries for the same session.
        await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pendingCheckout.id} FOR UPDATE`

        const fresh = await tx.extraFreeEventCheckout.findUnique({
          where: { id: pendingCheckout.id },
        })
        if (!fresh || ['credit_granted', 'auto_created', 'failed'].includes(fresh.status)) {
          return null
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

        return owner
      })

      if (!result) {
        return NextResponse.json({ received: true })
      }

      updatedOwner = result
    } else {
      // Legacy path: sessions created before the pending-row change.
      const existing = await prisma.owner.findFirst({
        where: { id: ownerId, extraEventCheckoutSessionId: session.id },
      })
      if (existing) {
        console.log(`[stripe/webhook] Owner ${existing.email} already fulfilled for extra free event session ${session.id}`)
        return NextResponse.json({ received: true })
      }

      updatedOwner = await prisma.owner.update({
        where: { id: ownerId },
        data: {
          extraEventCredits: { increment: 1 },
          extraEventCheckoutSessionId: session.id,
          updatedAt: new Date(),
        },
      })
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
      { distinctId: session.metadata?.ownerEmail || ownerId }
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
      { distinctId: session.metadata?.ownerEmail || ownerId }
    )

    await prisma.upsellEvent.create({
      data: {
        eventName: EVENT_UPSELL_CONVERSION,
        upsellType: session.metadata?.upsellType || 'extra_event',
        source: session.metadata?.upsellSource || session.metadata?.entryPoint || 'unknown',
        ctaPlan: 'extra_event',
        ownerId: ownerId || null,
      },
    })

    console.log(`[stripe/webhook] Owner ${updatedOwner.email} granted extra free event credit. Total credits: ${updatedOwner.extraEventCredits}`)

    await sendExtraFreeEventCreditGrantedEmail({
      owner: updatedOwner,
      credits: updatedOwner.extraEventCredits,
      appUrl: getAppUrl(),
    })
  } catch (dbError) {
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
        pendingCheckoutId: pendingCheckout?.id,
      },
    })
    return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

// ── Helper: "buy and create" auto-creation ──
async function fulfillExtraFreeEventBuyAndCreate({ prisma, session, ownerId, intent }) {
  const pendingCheckoutId = session.metadata?.pendingCheckoutId
  if (!pendingCheckoutId) {
    return NextResponse.json({ received: true })
  }

  let pending
  try {
    pending = await prisma.extraFreeEventCheckout.findFirst({
      where: { id: pendingCheckoutId },
    })
  } catch (lookupError) {
    console.error('[stripe/webhook] Failed to lookup pending checkout:', lookupError)
    return NextResponse.json({ error: 'Database lookup failed' }, { status: 500 })
  }

  if (!pending) {
    console.warn('[stripe/webhook] Pending checkout not found, skipping auto-create:', pendingCheckoutId)
    return NextResponse.json({ received: true })
  }

  if (pending.ownerId !== ownerId) {
    console.warn('[stripe/webhook] Pending checkout owner mismatch, skipping:', {
      pendingCheckoutId,
      expectedOwnerId: pending.ownerId,
      actualOwnerId: ownerId,
    })
    return NextResponse.json({ received: true })
  }

  if (pending.status === 'auto_created') {
    console.log(`[stripe/webhook] Pending checkout ${pendingCheckoutId} already auto-created, skipping`)
    return NextResponse.json({ received: true })
  }

  if (pending.status === 'failed') {
    console.log(`[stripe/webhook] Pending checkout ${pendingCheckoutId} already failed, leaving fallback credit in place`)
    return NextResponse.json({ received: true })
  }

  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true },
  })
  if (!owner) {
    console.warn('[stripe/webhook] Owner not found for auto-create, skipping:', ownerId)
    return NextResponse.json({ received: true })
  }

  try {
    const { prismaGalleryRepository } = await import('@/lib/server/prisma-gallery-repository')

    const result = await prisma.$transaction(async (tx) => {
      // Pessimistic lock: serialize concurrent webhook deliveries for the same session.
      await tx.$queryRaw`SELECT id FROM "ExtraFreeEventCheckout" WHERE id = ${pending.id} FOR UPDATE`

      const fresh = await tx.extraFreeEventCheckout.findUnique({
        where: { id: pending.id },
      })
      if (!fresh || fresh.status === 'auto_created' || fresh.status === 'failed') {
        return { skipped: true }
      }

      const event = await prismaGalleryRepository.createEvent({
        name: fresh.eventName,
        prismaClient: tx,
      })

      await tx.event.update({
        where: { id: event.id },
        data: {
          ownerId: owner.id,
          ownerEmail: owner.email,
        },
      })

      const updatedPending = await tx.extraFreeEventCheckout.update({
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

      return { event, updatedPending }
    })

    if (result.skipped) {
      return NextResponse.json({ received: true })
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
        pending_checkout_id: pending.id,
      },
      { distinctId: session.metadata?.ownerEmail || ownerId }
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
        pending_checkout_id: pending.id,
      },
      { distinctId: session.metadata?.ownerEmail || ownerId }
    )

    trackServerEvent(
      EXTRA_FREE_EVENT_AUTO_CREATE_SUCCESS,
      {
        pending_checkout_id: pending.id,
        checkout_session_id: session.id,
        event_slug: result.event.slug,
        source: 'stripe_webhook',
      },
      { distinctId: session.metadata?.ownerEmail || ownerId }
    )

    console.log(`[stripe/webhook] Auto-created event ${result.event.slug} for pending checkout ${pending.id}`)

    await sendExtraFreeEventCreatedEmail({
      owner,
      event: result.event,
      appUrl: getAppUrl(),
    })
  } catch (error) {
    console.error('[stripe/webhook] Auto-create event failed, granting fallback credit:', {
      pendingCheckoutId: pending.id,
      sessionId: session.id,
      error: error.message,
    })

    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:extra_free_event:auto_create_failed',
      title: 'Extra Free Event auto-create failed; fallback credit granted',
      message: error.message,
      context: {
        stripeSessionId: session.id,
        ownerId,
        pendingCheckoutId: pending.id,
        eventName: pending.eventName,
      },
    })

    try {
      await prisma.$transaction(async (tx) => {
        await tx.owner.update({
          where: { id: ownerId },
          data: {
            extraEventCredits: { increment: 1 },
            extraEventCheckoutSessionId: session.id,
            updatedAt: new Date(),
          },
        })
        await tx.extraFreeEventCheckout.update({
          where: { id: pending.id },
          data: {
            status: 'failed',
            stripeCheckoutSessionId: session.id,
            errorMessage: String(error?.message || 'auto_create_failed').slice(0, 500),
            completedAt: new Date(),
          },
        })
      })

      trackServerEvent(
        EXTRA_FREE_EVENT_AUTO_CREATE_FAILED,
        {
          pending_checkout_id: pending.id,
          checkout_session_id: session.id,
          fallback_credit_granted: true,
          reason: error.message,
          source: 'stripe_webhook',
        },
        { distinctId: session.metadata?.ownerEmail || ownerId }
      )

      await sendExtraFreeEventFallbackCreditEmail({
        owner,
        pending,
        appUrl: getAppUrl(),
      })
    } catch (fallbackError) {
      console.error('[stripe/webhook] Fallback credit grant also failed:', fallbackError)
      await sendOpsAlert({
        severity: 'critical',
        type: 'billing:extra_free_event:fallback_credit_failed',
        title: 'Extra Free Event fallback credit grant failed',
        message: fallbackError.message,
        context: {
          stripeSessionId: session.id,
          ownerId,
          pendingCheckoutId: pending.id,
          eventName: pending.eventName,
        },
      })
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
