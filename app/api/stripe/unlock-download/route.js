import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { verifySameOriginRequest, requireCsrfProtection } from '@/lib/server/csrf'
import { checkRateLimit, getClientIp, hashIdentifier, PAYMENT_LIMITS } from '@/lib/server/rate-limiter'
import { trackServerEvent } from '@/lib/analytics/track-server'
import { EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_STARTED } from '@/lib/analytics/events'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const logPrefix = '[stripe/unlock-download]'
  try {
    // Try to authenticate owner (optional — guests can also unlock)
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = token ? await verifyOwnerSessionToken(token) : null

    // Origin check for everyone; CSRF token required for authenticated owners
    const originCheck = verifySameOriginRequest(request)
    if (!originCheck.allowed) {
      return NextResponse.json({ error: originCheck.message, code: originCheck.code }, { status: 403 })
    }
    if (ownerEmail) {
      const csrf = requireCsrfProtection(request, ownerEmail)
      if (!csrf.success) {
        return NextResponse.json({ error: csrf.message, code: csrf.code }, { status: csrf.status })
      }
    }

    const clientIp = getClientIp(request)
    const ipKey = `unlock-download:ip:${hashIdentifier(clientIp)}`
    const ipRate = await checkRateLimit(ipKey, PAYMENT_LIMITS.unlockDownload.ip.max, PAYMENT_LIMITS.unlockDownload.ip.window)
    if (ipRate.limited) {
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please try again later.', code: 'rate_limited', retryAfter: ipRate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(ipRate.retryAfter) } }
      )
    }
    if (ownerEmail && PAYMENT_LIMITS.unlockDownload.owner) {
      const ownerKey = `unlock-download:owner:${hashIdentifier(ownerEmail)}`
      const ownerRate = await checkRateLimit(ownerKey, PAYMENT_LIMITS.unlockDownload.owner.max, PAYMENT_LIMITS.unlockDownload.owner.window)
      if (ownerRate.limited) {
        return NextResponse.json(
          { error: 'Too many checkout attempts. Please try again later.', code: 'rate_limited', retryAfter: ownerRate.retryAfter },
          { status: 429, headers: { 'Retry-After': String(ownerRate.retryAfter) } }
        )
      }
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

    // Look up owner if authenticated
    let owner = null
    if (ownerEmail) {
      const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
      owner = await resolveCanonicalOwner(ownerEmail)
    }

    const event = await prisma.event.findUnique({ where: { slug: eventSlug } })
    if (!event) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // If authenticated, verify ownership
    if (owner) {
      const isOwner =
        event.ownerId === owner.id ||
        event.ownerEmail?.toLowerCase() === ownerEmail.toLowerCase()
      if (!isOwner) {
        return NextResponse.json(
          { error: 'You do not own this room' },
          { status: 403 }
        )
      }
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

    const metadata = {
      intent: 'high_quality_download',
      eventId: event.id,
      roomSlug: event.slug,
      source: owner ? 'lightbox_owner' : 'lightbox_guest',
    }
    if (owner) {
      metadata.ownerId = owner.id
      metadata.ownerEmail = owner.email
    }

    const sessionConfig = {
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${baseUrl}/event/${eventSlug}?unlock=success`,
      cancel_url: `${baseUrl}/event/${eventSlug}?unlock=cancelled`,
      metadata,
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
        source: metadata.source,
      },
      { distinctId: owner?.email || session.customer_email || event.id }
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
