import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_STARTED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

const PRICE_ENV_MAP = {
  pro_event: 'STRIPE_PRICE_ID_PRO_EVENT',
  wedding_pro: 'STRIPE_PRICE_ID_WEDDING_PRO',
  professional: 'STRIPE_PRICE_ID_PROFESSIONAL',
}

const MODE_MAP = {
  pro_event: 'payment',
  wedding_pro: 'payment',
  professional: 'subscription',
}

export async function POST(request) {
  try {
    // Authenticate owner
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { intent, eventId } = body

    // Validate intent
    const validIntents = ['pro_event', 'wedding_pro', 'professional']
    if (!intent || !validIntents.includes(intent)) {
      return NextResponse.json({ error: 'Invalid or missing purchase intent' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const owner = await prisma.owner.findUnique({ where: { email: ownerEmail } })
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    // For event-based purchases, validate ownership
    let event = null
    if (eventId && (intent === 'pro_event' || intent === 'wedding_pro')) {
      event = await prisma.event.findFirst({
        where: {
          id: eventId,
          OR: [{ ownerId: owner.id }, { ownerEmail: owner.email }],
        },
      })
      if (!event) {
        return NextResponse.json({ error: 'Event not found or not owned by you' }, { status: 403 })
      }
      if (event.billingTier) {
        return NextResponse.json({ error: 'This event has already been upgraded' }, { status: 409 })
      }
    }

    const priceIdEnv = PRICE_ENV_MAP[intent]
    const priceId = process.env[priceIdEnv]
    if (!priceId) {
      return NextResponse.json(
        { error: `Stripe price not configured for intent: ${intent}` },
        { status: 500 }
      )
    }

    const stripe = getStripe()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'
    const mode = MODE_MAP[intent]

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

    const sessionConfig = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url: `${baseUrl}/dashboard?upgrade=success&intent=${intent}`,
      cancel_url: `${baseUrl}/dashboard?upgrade=cancelled&intent=${intent}`,
      metadata: {
        intent,
        ownerId: owner.id,
        ownerEmail: owner.email,
        eventId: event?.id || '',
        roomSlug: event?.slug || '',
        currentPlan: owner.plan || 'free',
        entryPoint: body.entryPoint || 'dashboard',
      },
    }

    if (mode === 'subscription') {
      sessionConfig.subscription_data = {
        metadata: {
          intent,
          ownerId: owner.id,
        },
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)

    trackServerEvent(EVENT_CHECKOUT_STARTED, {
      distinctId: owner.email,
      owner_id: owner.id,
      billing_intent: intent,
      entry_point: body.entryPoint || 'dashboard',
      room_slug: event?.slug || null,
      event_id: event?.id || null,
      stripe_session_id: session.id,
      stripe_mode: mode,
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
