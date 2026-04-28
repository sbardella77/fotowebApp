import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_STARTED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    // Authenticate owner
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const owner = await prisma.owner.findUnique({ where: { email: ownerEmail } })
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    const stripe = getStripe()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'
    const priceId = process.env.STRIPE_PRICE_ID

    if (!priceId) {
      return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 })
    }

    // Get or create Stripe customer
    let customerId = owner.stripeCustomerId
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.email,
        metadata: { ownerId: owner.id },
      })
      customerId = customer.id
      await prisma.owner.update({
        where: { id: owner.id },
        data: { stripeCustomerId: customerId },
      })
    }

    // Create Checkout Session in subscription mode
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${baseUrl}/dashboard?upgrade=success`,
      cancel_url: `${baseUrl}/dashboard?upgrade=cancelled`,
      metadata: {
        ownerId: owner.id,
        ownerEmail: owner.email,
        currentPlan: owner.plan || 'free',
        entryPoint: 'dashboard_banner',
      },
      subscription_data: {
        metadata: {
          ownerId: owner.id,
        },
      },
    })

    trackServerEvent(EVENT_CHECKOUT_STARTED, {
      distinctId: owner.email,
      owner_id: owner.id,
      entry_point: 'dashboard_banner',
      stripe_session_id: session.id,
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[stripe/checkout-session]', error)
    return NextResponse.json(
      { error: error?.message || 'Unable to start checkout' },
      { status: 500 }
    )
  }
}
