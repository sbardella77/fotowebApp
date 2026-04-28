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
  // Initial Pro upgrade after successful Checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const ownerId = session.metadata?.ownerId

    if (!ownerId) {
      console.warn('[stripe/webhook] Missing ownerId in session metadata')
      return NextResponse.json({ received: true })
    }

    try {
      const owner = await prisma.owner.update({
        where: { id: ownerId },
        data: {
          plan: 'pro',
          stripeSubscriptionId: session.subscription || null,
          stripeCheckoutSessionId: session.id,
          planUpdatedAt: new Date(),
        },
      })

      trackServerEvent(EVENT_CHECKOUT_COMPLETED, {
        distinctId: owner.email,
        owner_id: owner.id,
        stripe_session_id: session.id,
        stripe_subscription_id: session.subscription,
        stripe_customer_id: session.customer,
      })

      console.log('[stripe/webhook] Owner upgraded to Pro:', owner.email)
    } catch (dbError) {
      console.error('[stripe/webhook] Failed to update owner plan:', dbError)
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
    }
  }

  // ── customer.subscription.updated ──
  // Handle status changes: payment failures, reactivations, cancellations
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

      const newPlan = isActiveSubscription(status) ? 'pro' : 'free'

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
  // Subscription fully ended — downgrade to free
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
