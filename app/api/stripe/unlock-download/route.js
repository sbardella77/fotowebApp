import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_STARTED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const logPrefix = '[stripe/unlock-download]'
  try {
    // Authenticate owner
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

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

    const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
    const owner = await resolveCanonicalOwner(ownerEmail)
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    const event = await prisma.event.findUnique({ where: { slug: eventSlug } })
    if (!event) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // Verify ownership
    const isOwner =
      event.ownerId === owner.id ||
      event.ownerEmail?.toLowerCase() === ownerEmail.toLowerCase()
    if (!isOwner) {
      return NextResponse.json(
        { error: 'You do not own this room' },
        { status: 403 }
      )
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
      success_url: `${baseUrl}/dashboard?upgrade=success&intent=high_quality_download`,
      cancel_url: `${baseUrl}/dashboard?upgrade=cancelled&intent=high_quality_download`,
      metadata: {
        intent: 'high_quality_download',
        eventId: event.id,
        roomSlug: event.slug,
        ownerId: owner.id,
        ownerEmail: owner.email,
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

    trackServerEvent(
      EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_STARTED,
      {
        billing_intent: 'high_quality_download',
        event_id: event.id,
        room_slug: event.slug,
        stripe_session_id: session.id,
        stripe_mode: 'payment',
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
