import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  EVENT_CHECKOUT_COMPLETED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_COMPLETED,
  EVENT_UPSELL_CONVERSION,
} from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

function isActiveSubscription(status) {
  return status === 'active' || status === 'trialing'
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
            stripeSubscriptionId: session.subscription || null,
            stripeCheckoutSessionId: session.id,
            planUpdatedAt: new Date(),
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

      const newPlan = isActiveSubscription(status) ? 'professional' : 'free'

      if (owner.plan !== newPlan) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: {
            plan: newPlan,
            planUpdatedAt: new Date(),
          },
        })
        console.log(`[stripe/webhook] Owner ${owner.email} plan changed to ${newPlan} (status: ${status})`)
      }
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
        data: {
          plan: 'free',
          stripeSubscriptionId: null,
          subscriptionCanceledAt: new Date(),
          planUpdatedAt: new Date(),
        },
      })

      console.log('[stripe/webhook] Owner downgraded to free after subscription deletion:', owner.email)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to handle subscription deletion:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
