import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_CHECKOUT_STARTED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const logPrefix = '[stripe/unlock-download]'
  try {
    const body = await request.json().catch(() => ({}))
    const { eventSlug } = body

    if (!eventSlug || typeof eventSlug !== 'string') {
      return NextResponse.json({ error: 'Event slug is required' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error(`${logPrefix} Database unavailable`)
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const event = await prisma.event.findUnique({ where: { slug: eventSlug } })
    if (!event) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    if (event.originalDownloadUnlocked) {
      return NextResponse.json(
        { error: 'Original quality downloads are already unlocked for this room' },
        { status: 409 }
      )
    }

    const priceId = process.env.STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD
    if (!priceId) {
      console.error(`${logPrefix} Missing env var: STRIPE_PRICE_ID_HIGH_QUALITY_DOWNLOAD`)
      return NextResponse.json(
        { error: 'Stripe price not configured for download unlock' },
        { status: 500 }
      )
    }

    if (!priceId.startsWith('price_')) {
      console.error(`${logPrefix} Invalid price ID format: "${priceId}"`)
      return NextResponse.json(
        { error: 'Stripe price ID is misconfigured for download unlock' },
        { status: 500 }
      )
    }

    const stripe = getStripe()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'

    const sessionConfig = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${baseUrl}/event/${eventSlug}?unlock=success`,
      cancel_url: `${baseUrl}/event/${eventSlug}?unlock=cancelled`,
      metadata: {
        intent: 'high_quality_download',
        eventId: event.id,
        roomSlug: event.slug,
      },
    }

    let session
    try {
      session = await stripe.checkout.sessions.create(sessionConfig)
    } catch (stripeError) {
      const rawMessage = stripeError?.message || 'Unknown Stripe error'
      console.error(`${logPrefix} Stripe checkout session creation failed:`, {
        eventId: event.id,
        roomSlug: event.slug,
        priceId,
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

      return NextResponse.json({ error: rawMessage }, { status: 502 })
    }

    trackServerEvent(EVENT_CHECKOUT_STARTED, {
      billing_intent: 'high_quality_download',
      event_id: event.id,
      room_slug: event.slug,
      stripe_session_id: session.id,
      stripe_mode: 'payment',
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error)
    return NextResponse.json(
      { error: 'Unable to start checkout. Please try again later.' },
      { status: 500 }
    )
  }
}
