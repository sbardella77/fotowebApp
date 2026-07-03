import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { verifySameOriginRequest, requireCsrfProtection } from '@/lib/server/csrf'
import { checkRateLimit, getClientIp, hashIdentifier, PAYMENT_LIMITS } from '@/lib/server/rate-limiter'
import { validatePendingEventName } from '@/lib/extra-free-event-pending'
import { trackServerEvent } from '@/lib/analytics/track-server'
import {
  EVENT_CHECKOUT_STARTED,
  EVENT_UPSELL_CHECKOUT_START,
  EXTRA_FREE_EVENT_CHECKOUT_CREATED,
} from '@/lib/analytics/events'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

const PRICE_ENV_MAP = {
  pro_event: 'STRIPE_PRICE_ID_PRO_EVENT',
  wedding_pro: 'STRIPE_PRICE_ID_WEDDING_PRO',
  professional: 'STRIPE_PRICE_ID_PROFESSIONAL',
  extra_event: 'STRIPE_PRICE_ID_EXTRA_EVENT',
}

function getProfessionalPriceId(billingInterval) {
  if (billingInterval === 'annual') {
    return process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL
  }
  return process.env.STRIPE_PRICE_ID_PROFESSIONAL
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

    // Origin check + CSRF token validation
    const originCheck = verifySameOriginRequest(request)
    if (!originCheck.allowed) {
      return NextResponse.json({ error: originCheck.message, code: originCheck.code }, { status: 403 })
    }

    const csrf = requireCsrfProtection(request, ownerEmail)
    if (!csrf.success) {
      return NextResponse.json({ error: csrf.message, code: csrf.code }, { status: csrf.status })
    }

    const body = await request.json().catch(() => ({}))
    const { intent, eventId, upsellType, upsellSource, extraMetadata = {}, billingInterval } = body

    // Rate limit by owner + intent before any Stripe call
    const limitConfig =
      intent === 'extra_event'
        ? PAYMENT_LIMITS.checkoutExtraEvent
        : intent === 'professional'
          ? PAYMENT_LIMITS.checkoutProfessional
          : PAYMENT_LIMITS.checkoutSession

    const clientIp = getClientIp(request)
    const ownerKey = `checkout:${intent}:owner:${hashIdentifier(ownerEmail)}`
    const ipKey = `checkout:${intent}:ip:${hashIdentifier(clientIp)}`
    const ownerRate = limitConfig.owner
      ? await checkRateLimit(ownerKey, limitConfig.owner.max, limitConfig.owner.window)
      : { limited: false }
    const ipRate = limitConfig.ip
      ? await checkRateLimit(ipKey, limitConfig.ip.max, limitConfig.ip.window)
      : { limited: false }
    if (ownerRate.limited || ipRate.limited) {
      const result = ownerRate.limited ? ownerRate : ipRate
      return NextResponse.json(
        { error: 'Too many checkout attempts. Please try again later.', code: 'rate_limited', retryAfter: result.retryAfter },
        { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
      )
    }
    const validation =
      intent === 'extra_event' && extraMetadata?.pendingEventName
        ? validatePendingEventName(extraMetadata.pendingEventName)
        : { valid: false, value: '' }
    const pendingEventName = validation.valid ? validation.value : null
    const postPurchaseAction = pendingEventName ? 'create_event' : 'credit_only'

    // Validate pending event name for the "buy and create" flow
    if (intent === 'extra_event' && extraMetadata?.postPurchaseAction === 'create_event') {
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'Event name must be between 3 and 120 characters' },
          { status: 400 }
        )
      }
    }

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

    // Validate billing interval for subscriptions
    const normalizedBillingInterval = billingInterval === 'annual' ? 'annual' : 'monthly'
    if (intent === 'professional' && billingInterval && !['monthly', 'annual'].includes(billingInterval)) {
      return NextResponse.json(
        { error: 'Invalid billing interval. Choose monthly or annual.' },
        { status: 400 }
      )
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
      if (event.billingTier === intent) {
        return NextResponse.json(
          {
            error:
              intent === 'wedding_pro'
                ? 'This event is already Wedding Pro.'
                : 'This event is already Pro Event.',
            code: intent === 'wedding_pro' ? 'event_already_wedding_pro' : 'event_already_pro_event',
            currentTier: event.billingTier,
          },
          { status: 409 }
        )
      }

      if (intent === 'pro_event' && event.billingTier === 'wedding_pro') {
        return NextResponse.json(
          { error: 'This event is already Wedding Pro.', code: 'event_already_wedding_pro', currentTier: event.billingTier },
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
    const priceId =
      intent === 'professional'
        ? getProfessionalPriceId(normalizedBillingInterval)
        : process.env[priceIdEnv]
    if (!priceId) {
      if (intent === 'extra_event') {
        console.error('[checkout] Missing STRIPE_PRICE_ID_EXTRA_EVENT')
        return NextResponse.json(
          { error: 'Extra Free Event checkout is not configured.' },
          { status: 500 }
        )
      }
      const isAnnualMissing =
        intent === 'professional' && normalizedBillingInterval === 'annual'
      const missingEnvVar = isAnnualMissing ? 'STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL' : priceIdEnv
      console.error(`${logPrefix} Missing env var: ${missingEnvVar} for intent=${intent}, billingInterval=${normalizedBillingInterval}`)
      return NextResponse.json(
        {
          error: isAnnualMissing
            ? 'The annual Professional plan is not available at the moment. Please choose the monthly plan or contact support.'
            : `Stripe price not configured for intent: ${intent}`,
        },
        { status: isAnnualMissing ? 503 : 500 }
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

    let extraFreeEventCheckout = null
    if (intent === 'extra_event') {
      extraFreeEventCheckout = await prisma.extraFreeEventCheckout.create({
        data: {
          ownerId: owner.id,
          eventName: pendingEventName,
          status: 'pending',
        },
      })
    }

    const sessionConfig = {
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode,
      success_url:
        intent === 'extra_event'
          ? `${baseUrl}/dashboard?extraEvent=success${postPurchaseAction === 'create_event' ? '&createPendingEvent=1&session_id={CHECKOUT_SESSION_ID}' : ''}`
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
        billingInterval: intent === 'professional' ? normalizedBillingInterval : '',
        ...(intent === 'extra_event' ? { productType: 'extra_free_event', restrictions: 'free_plan' } : {}),
        ...(extraFreeEventCheckout
          ? { postPurchaseAction, pendingCheckoutId: extraFreeEventCheckout.id }
          : {}),

      },
    }

    if (mode === 'subscription') {
      sessionConfig.subscription_data = {
        metadata: {
          intent,
          ownerId: owner.id,
          billingInterval: normalizedBillingInterval,
        },
      }
    }

    let session
    try {
      session = await stripe.checkout.sessions.create(sessionConfig)

      if (extraFreeEventCheckout) {
        await prisma.extraFreeEventCheckout.update({
          where: { id: extraFreeEventCheckout.id },
          data: {
            stripeCheckoutSessionId: session.id,
            status: 'checkout_created',
          },
        })
      }
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

    if (extraFreeEventCheckout) {
      trackServerEvent(
        EXTRA_FREE_EVENT_CHECKOUT_CREATED,
        {
          owner_id: owner.id,
          pending_checkout_id: extraFreeEventCheckout.id,
          source: upsellSource || body.entryPoint || 'create_room_modal',
          post_purchase_action: postPurchaseAction,
          stripe_session_id: session.id,
        },
        { distinctId: owner.email }
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
    await sendOpsAlert({
      severity: 'critical',
      type: 'billing:checkout:start_failed',
      title: 'Stripe checkout session creation failed',
      message: error.message,
      context: {
        intent: body?.intent,
        eventId: body?.eventId,
        ownerEmail: ownerEmail || null,
      },
    })
    return NextResponse.json(
      { error: 'Unable to start checkout. Please try again later.' },
      { status: 500 }
    )
  }
}
