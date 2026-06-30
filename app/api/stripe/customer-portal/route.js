import { NextResponse } from 'next/server'
import { getStripe } from '@/lib/server/stripe'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { verifySameOriginRequest, requireCsrfProtection } from '@/lib/server/csrf'
import { checkRateLimit, getClientIp, hashIdentifier, PAYMENT_LIMITS } from '@/lib/server/rate-limiter'

export const dynamic = 'force-dynamic'

const SUBSCRIPTION_PLANS = new Set(['professional', 'business', 'pro'])

export async function POST(request) {
  const logPrefix = '[stripe/customer-portal]'
  try {
    // 1. Owner authentication
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // 2. Same-origin check
    const originCheck = verifySameOriginRequest(request)
    if (!originCheck.allowed) {
      return NextResponse.json({ error: originCheck.message, code: originCheck.code }, { status: 403 })
    }

    // 3. CSRF protection
    const csrf = requireCsrfProtection(request, ownerEmail)
    if (!csrf.success) {
      return NextResponse.json({ error: csrf.message, code: csrf.code }, { status: csrf.status })
    }

    // 4. Rate limit
    const clientIp = getClientIp(request)
    const ownerKey = `customer-portal:owner:${hashIdentifier(ownerEmail)}`
    const ipKey = `customer-portal:ip:${hashIdentifier(clientIp)}`
    const ownerRate = await checkRateLimit(
      ownerKey,
      PAYMENT_LIMITS.customerPortal.owner.max,
      PAYMENT_LIMITS.customerPortal.owner.window
    )
    const ipRate = PAYMENT_LIMITS.customerPortal.ip
      ? await checkRateLimit(
          ipKey,
          PAYMENT_LIMITS.customerPortal.ip.max,
          PAYMENT_LIMITS.customerPortal.ip.window
        )
      : { limited: false }
    if (ownerRate.limited || ipRate.limited) {
      const result = ownerRate.limited ? ownerRate : ipRate
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: result.retryAfter },
        { status: 429, headers: { 'Retry-After': String(result.retryAfter) } }
      )
    }

    // 5. Load owner
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

    // 6. Portal eligibility: need a Stripe customer and a subscription to manage.
    //    One-time event upgrades do not open the subscription portal in V1.
    if (!owner.stripeCustomerId) {
      return NextResponse.json(
        { error: 'Billing portal is not available for this account.' },
        { status: 404 }
      )
    }

    const hasSubscription =
      SUBSCRIPTION_PLANS.has(owner.plan) || !!owner.stripeSubscriptionId || !!owner.subscriptionCanceledAt
    if (!hasSubscription) {
      return NextResponse.json(
        { error: 'Billing portal is not available for this account.' },
        { status: 404 }
      )
    }

    // 7. Create Stripe Customer Portal session
    const stripe = getStripe()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://snaprooms.app'
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: owner.stripeCustomerId,
      return_url: `${baseUrl}/dashboard?billing=portal_return`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error)
    return NextResponse.json(
      { error: 'Unable to open billing portal. Please try again later.' },
      { status: 500 }
    )
  }
}
