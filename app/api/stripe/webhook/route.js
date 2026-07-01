import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { Resend } from 'resend'
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
  EVENT_CHECKOUT_COMPLETED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED,
  EVENT_UPSELL_CONVERSION,
  EXTRA_FREE_EVENT_AUTO_CREATE_FAILED,
  EXTRA_FREE_EVENT_AUTO_CREATE_SUCCESS,
} from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app').replace(/\/$/, '')
}

async function sendPaymentFailedEmail(owner, invoice, access) {
  if (!resend || !process.env.RESEND_FROM_EMAIL) {
    return
  }

  try {
    const baseUrl = getAppUrl()
    const graceDays = GRACE_PERIOD_DAYS
    const subject = 'Payment failed – please update your payment method'
    const dashboardUrl = `${baseUrl}/dashboard`
    const text = `Hi,

Your SnapRooms Professional payment could not be processed. Please update your payment method within ${graceDays} days to keep your Professional features active.

Update your payment method here:
${dashboardUrl}

– SnapRooms
Every guest photo. One room.`

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;"><span style="font-size:20px;font-weight:700;color:#d4a853;letter-spacing:-0.5px;">SnapRooms</span></div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Payment failed</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">We couldn't process your Professional payment. Please update your payment method within <strong>${graceDays} days</strong> to avoid any interruption.</p>
  <p style="margin:0 0 24px;text-align:center;"><a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#d4a853;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Update payment method</a></p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">If you already updated your card, you can ignore this email.<br>SnapRooms — Every guest photo. One room.</p>
</div>`

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: owner.email,
      reply_to: 'hello@snaprooms.app',
      subject,
      text,
      html,
    })
  } catch (emailError) {
    console.error('[stripe/webhook] Failed to send payment-failed email:', emailError)
  }
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
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.error('[stripe/webhook] Database unavailable')
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  // ── checkout.session.completed ──
  if (event.type === 'checkout.session.completed') {
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
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
      }

      return NextResponse.json({ received: true })
    }

    if (!ownerId) {
      console.warn('[stripe/webhook] Missing ownerId in session metadata')
      return NextResponse.json({ received: true })
    }

    // ── Extra Free Event one-time credit ──
    if (intent === 'extra_event') {
      const pendingCheckoutId = session.metadata?.pendingCheckoutId
      const postPurchaseAction = session.metadata?.postPurchaseAction

      if (pendingCheckoutId && postPurchaseAction === 'create_event') {
        return await fulfillExtraFreeEventBuyAndCreate({ prisma, session, ownerId, intent })
      }

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

        const updatedEvent = await prisma.event.update({
          where: { id: eventId },
          data: {
            billingTier: intent,
            stripeCheckoutSessionId: session.id,
            billingPurchasedAt: new Date(),
          },
        })

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
            planUpdatedAt: new Date(),
            // Clear any previous failure/cancellation timestamps on re-subscription.
            paymentFailedAt: null,
            subscriptionGraceUntil: null,
            subscriptionCanceledAt: null,
            lastPaymentError: null,
          },
        })

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
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
      }
    }

    else {
      console.warn('[stripe/webhook] Unknown checkout intent:', intent)
    }
  }

  // ── customer.subscription.updated ──
  // Handle status changes for Professional subscriptions
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object
    const subscriptionId = subscription.id
    const status = subscription.status

    try {
      const owner = await prisma.owner.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      })

      if (!owner) {
        console.warn('[stripe/webhook] Owner not found for subscription:', subscriptionId)
        return NextResponse.json({ received: true })
      }

      const updateData = buildSubscriptionUpdatedData({ status, owner })
      await prisma.owner.update({
        where: { id: owner.id },
        data: updateData,
      })
      console.log(`[stripe/webhook] Owner ${owner.email} subscription updated (status: ${status}, plan: ${updateData.plan})`)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to handle subscription update:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  // ── customer.subscription.deleted ──
  // Professional subscription fully ended
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    const subscriptionId = subscription.id

    try {
      const owner = await prisma.owner.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      })

      if (!owner) {
        console.warn('[stripe/webhook] Owner not found for deleted subscription:', subscriptionId)
        return NextResponse.json({ received: true })
      }

      await prisma.owner.update({
        where: { id: owner.id },
        data: buildSubscriptionDeletedData(),
      })

      console.log('[stripe/webhook] Owner downgraded to free after subscription deletion:', owner.email)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to handle subscription deletion:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  // ── invoice.payment_failed ──
  // Professional payment failed: enter past_due with a grace period.
  if (event.type === 'invoice.payment_failed') {
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

      await sendPaymentFailedEmail(owner, invoice, access)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to handle payment failure:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    return NextResponse.json({ received: true })
  }

  // ── invoice.payment_succeeded ──
  // Subscription payment recovered: restore active state.
  if (event.type === 'invoice.payment_succeeded') {
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
        return NextResponse.json({ received: true })
      }

      await prisma.owner.update({
        where: { id: owner.id },
        data: buildPaymentSucceededUpdate(invoice),
      })

      console.log('[stripe/webhook] Owner payment succeeded, subscription restored:', owner.email)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to handle payment success:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}


// ── Helper: legacy Extra Free Event credit fulfillment ──
async function fulfillExtraFreeEventCredit({ prisma, session, ownerId, intent }) {
  try {
    // Idempotency: skip if this exact session already fulfilled
    const existing = await prisma.owner.findFirst({
      where: { id: ownerId, extraEventCheckoutSessionId: session.id },
    })
    if (existing) {
      console.log(`[stripe/webhook] Owner ${existing.email} already fulfilled for extra free event session ${session.id}`)
      return NextResponse.json({ received: true })
    }

    const updatedOwner = await prisma.owner.update({
      where: { id: ownerId },
      data: {
        extraEventCredits: { increment: 1 },
        extraEventCheckoutSessionId: session.id,
        updatedAt: new Date(),
      },
    })

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
  } catch (dbError) {
    if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2025') {
      console.warn('[stripe/webhook] Owner not found for extra free event fulfillment, skipping:', ownerId)
      return NextResponse.json({ received: true })
    }
    console.error('[stripe/webhook] Failed to grant extra free event credit:', dbError)
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
  } catch (error) {
    console.error('[stripe/webhook] Auto-create event failed, granting fallback credit:', {
      pendingCheckoutId: pending.id,
      sessionId: session.id,
      error: error.message,
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
    } catch (fallbackError) {
      console.error('[stripe/webhook] Fallback credit grant also failed:', fallbackError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
