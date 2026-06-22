import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_STARTED, EVENT_UPSELL_CHECKOUT_START } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

const PRICE_ENV_MAP = {
  pro_event: 'STRIPE_PRICE_ID_PRO_EVENT',
  wedding_pro: 'STRIPE_PRICE_ID_WEDDING_PRO',
  professional: 'STRIPE_PRICE_ID_PROFESSIONAL',
  extra_event: 'STRIPE_PRICE_ID_EXTRA_EVENT',
}

const MODE_MAP = {
  pro_event: 'payment',
  wedding_pro: 'payment',
  professional: 'subscription',
  extra_event: 'payment',
}

export async function POST(request) {
  const logPrefix = '[stripe/checkout-session]'
  try {
    // Authenticate owner
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { intent, eventId, upsellType, upsellSource, extraMetadata = {} } = body
    const pendingEventName =
      intent === 'extra_event' && extraMetadata?.pendingEventName
        ? String(extraMetadata.pendingEventName).trim().slice(0, 120)
        : null
    const postPurchaseAction = pendingEventName ? 'create_event' : null

    // Validate intent
    const validIntents = ['pro_event', 'wedding_pro', 'professional', 'extra_event']
    if (!intent || !validIntents.includes(intent)) {
      return NextResponse.json({ error: 'Invalid or missing purchase intent' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error(`${logPrefix} Database unavailable`)
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
    const owner = await resolveCanonicalOwner(ownerEmail)
    if (!owner) {
      console.error(`${logPrefix} Owner not found for email:`, ownerEmail)
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    // For event-based purchases, eventId is required
    if ((intent === 'pro_event' || intent === 'wedding_pro') && !eventId) {
      return NextResponse.json({ error: 'eventId is required for event-based purchases' }, { status: 400 })
    }

    // Extra Free Event is a one-time account-level credit, no eventId needed
    if (intent === 'extra_event' && eventId) {
      return NextResponse.json({ error: 'eventId must not be provided for extra_event purchases' }, { status: 400 })
    }

    // Prevent duplicate Professional subscription
    if (intent === 'professional' && owner.plan === 'professional' && owner.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'You already have an active Professional subscription' },
        { status: 409 }
      )
    }

    // For event-based purchases, validate ownership and current state
    let event = null
    if (eventId && (intent === 'pro_event' || intent === 'wedding_pro')) {
      event = await prisma.event.findFirst({
        where: {
          id: eventId,
          OR: [{ ownerId: owner.id }, { ownerEmail: owner.email }],
        },
      })
      if (!event) {
        console.warn(`${logPrefix} Event not found or not owned. eventId=${eventId}, ownerId=${owner.id}`)
        return NextResponse.json({ error: 'Event not found or not owned by you' }, { status: 403 })
      }
      if (event.billingTier) {
        return NextResponse.json(
          { error: 'This event has already been upgraded', currentTier: event.billingTier },
          { status: 409 }
        )
      }
      // Hardening: Professional/Business owners already have unlimited photos; block accidental event upgrades
      if (owner.plan === 'professional' || owner.plan === 'business' || owner.plan === 'pro') {
        return NextResponse.json(
          { error: 'Your account plan already includes unlimited photos for all events' },
          { status: 409 }
        )
      }
    }

    const priceIdEnv = PRICE_ENV_MAP[intent]
    const priceId = process.env[priceIdEnv]
    if (!priceId) {
      if (intent === 'extra_event') {
        console.error('[checkout] Missing STRIPE_PRICE_ID_EXTRA_EVENT')
        return NextResponse.json(
          { error: 'Extra Free Event checkout is not configured.' },
          { status: 500 }
        )
      }
      console.error(`${logPrefix} Missing env var: ${priceIdEnv} for intent=${intent}`)
      return NextResponse.json(
        { error: `Stripe price not configured for intent: ${intent}` },
        { status: 500 }
      )
    }

    // Defensive: ensure priceId looks like a Stripe price ID
    if (!priceId.startsWith('price_')) {
      console.error(`${logPrefix} Invalid price ID format for ${priceIdEnv}: "${priceId}"`)
      return NextResponse.json(
        { error: `Stripe price ID is misconfigured for intent: ${intent}` },
        { status: 500 }
      )
    }

    const stripe = getStripe()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'
    const mode = MODE_MAP[intent]

    // Get or create Stripe customer
    let customerId = owner.stripeCustomerId
    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email: owner.email,
          metadata: { ownerId: owner.id },
        })
        customerId = customer.id
        await prisma.owner.update({
          where: { id: owner.id },
          data: { stripeCustomerId: customerId },
        })
      } catch (customerError) {
        console.error(`${logPrefix} Stripe customer creation failed:`, customerError)
        return NextResponse.json(
          { error: 'Unable to create Stripe customer. Please try again.' },
          { status: 502 }
        )
      }
    }

    const sessionConfig = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url:
        intent === 'extra_event'
          ? `${baseUrl}/dashboard?extraEvent=success${postPurchaseAction ? '&createPendingEvent=1&session_id={CHECKOUT_SESSION_ID}' : ''}`
          : `${baseUrl}/dashboard?upgrade=success&intent=${intent}`,
      cancel_url: `${baseUrl}/dashboard?${intent === 'extra_event' ? 'extraEvent=cancelled' : `upgrade=cancelled&intent=${intent}`}`,
      metadata: {
        intent,
        ownerId: owner.id,
        ownerEmail: owner.email,
        eventId: event?.id || '',
        roomSlug: event?.slug || '',
        currentPlan: owner.plan || 'free',
        entryPoint: body.entryPoint || 'dashboard',
        upsellType: upsellType || intent,
        upsellSource: upsellSource || body.entryPoint || 'unknown',
        ...(intent === 'extra_event' ? { productType: 'extra_free_event', restrictions: 'free_plan' } : {}),
        ...(postPurchaseAction ? { postPurchaseAction, pendingEventName } : {}),
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

    let session
    try {
      session = await stripe.checkout.sessions.create(sessionConfig)
    } catch (stripeError) {
      const rawMessage = stripeError?.message || 'Unknown Stripe error'
      console.error(`${logPrefix} Stripe checkout session creation failed:`, {
        intent,
        eventId: event?.id || null,
        ownerId: owner.id,
        priceId,
        mode,
        stripeErrorType: stripeError?.type,
        stripeCode: stripeError?.code,
        message: rawMessage,
      })

      if (rawMessage.includes('No such price')) {
        return NextResponse.json(
          { error: 'Stripe price not found. The price ID may belong to a different environment (test vs live).' },
          { status: 502 }
        )
      }

      return NextResponse.json(
        { error: rawMessage },
        { status: 502 }
      )
    }

    trackServerEvent(
      EVENT_CHECKOUT_STARTED,
      {
        owner_id: owner.id,
        billing_intent: intent,
        entry_point: body.entryPoint || 'dashboard',
        room_slug: event?.slug || null,
        event_id: event?.id || null,
        stripe_session_id: session.id,
        stripe_mode: mode,
      },
      { distinctId: owner.email }
    )

    trackServerEvent(
      EVENT_UPSELL_CHECKOUT_START,
      {
        owner_id: owner.id,
        billing_intent: intent,
        upsell_type: upsellType || intent,
        source: upsellSource || body.entryPoint || 'unknown',
        entry_point: body.entryPoint || 'dashboard',
        room_slug: event?.slug || null,
        event_id: event?.id || null,
        stripe_session_id: session.id,
        stripe_mode: mode,
      },
      { distinctId: owner.email }
    )

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error)
    return NextResponse.json(
      { error: 'Unable to start checkout. Please try again later.' },
      { status: 500 }
    )
  }
}
