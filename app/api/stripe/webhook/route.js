import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_COMPLETED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

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

  // Only process checkout completion
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const ownerId = session.metadata?.ownerId

    if (!ownerId) {
      console.warn('[stripe/webhook] Missing ownerId in session metadata')
      return NextResponse.json({ received: true })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error('[stripe/webhook] Database unavailable')
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    try {
      // Upsert plan to pro and persist Stripe IDs
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

  return NextResponse.json({ received: true })
}
