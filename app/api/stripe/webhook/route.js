import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_COMPLETED } from '@/lib/analytics/events'

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

    if (!ownerId) {
      console.warn('[stripe/webhook] Missing ownerId in session metadata')
      return NextResponse.json({ received: true })
    }

    // ── Event-based one-time purchase ──
    if (intent === 'pro_event' || intent === 'wedding_pro') {
      if (!eventId) {
        console.warn('[stripe/webhook] Missing eventId for event-based purchase:', intent)
        return NextResponse.json({ received: true })
      }

      try {
        const updatedEvent = await prisma.event.update({
          where: { id: eventId },
          data: {
            billingTier: intent,
            stripeCheckoutSessionId: session.id,
            billingPurchasedAt: new Date(),
          },
        })

        trackServerEvent(EVENT_CHECKOUT_COMPLETED, {
          distinctId: session.metadata?.ownerEmail || ownerId,
          owner_id: ownerId,
          billing_intent: intent,
          event_id: eventId,
          room_slug: session.metadata?.roomSlug || null,
          stripe_session_id: session.id,
          stripe_customer_id: session.customer,
        })

        console.log(`[stripe/webhook] Event ${updatedEvent.slug} upgraded to ${intent}`)
      } catch (dbError) {
        console.error('[stripe/webhook] Failed to update event billing:', dbError)
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
      }
    }

    // ── Account-level recurring subscription ──
    else if (intent === 'professional') {
      try {
        const owner = await prisma.owner.update({
          where: { id: ownerId },
          data: {
            plan: 'professional',
            stripeSubscriptionId: session.subscription || null,
            stripeCheckoutSessionId: session.id,
            planUpdatedAt: new Date(),
          },
        })

        trackServerEvent(EVENT_CHECKOUT_COMPLETED, {
          distinctId: owner.email,
          owner_id: owner.id,
          billing_intent: intent,
          stripe_session_id: session.id,
          stripe_subscription_id: session.subscription,
          stripe_customer_id: session.customer,
        })

        console.log('[stripe/webhook] Owner upgraded to Professional:', owner.email)
      } catch (dbError) {
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
