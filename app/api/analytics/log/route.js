import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'

export const dynamic = 'force-dynamic'

const VALID_EVENTS = new Set([
  'upsell_impression',
  'upsell_click',
  'upsell_checkout_start',
  'upsell_conversion',
])

const sanitizeString = (value, maxLength) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

export async function POST(request) {
  try {
    const clientIp = getClientIp(request)
    const rate = await checkRateLimit(
      `analytics:log:ip:${hashIdentifier(clientIp)}`,
      RATE_LIMITS.analyticsLog.ip.max,
      RATE_LIMITS.analyticsLog.ip.window
    )
    if (rate.limited) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } }
      )
    }

    const body = await request.json().catch(() => ({}))

    if (!body.eventName || !VALID_EVENTS.has(body.eventName)) {
      return NextResponse.json({ error: 'Invalid event name' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Never trust ownerId from the request body: derive it from the owner
    // session when present, otherwise log the event anonymously.
    let ownerId = null
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (ownerEmail) {
      const owner = await resolveCanonicalOwner(ownerEmail)
      ownerId = owner?.id || null
    }

    await prisma.upsellEvent.create({
      data: {
        eventName: body.eventName,
        upsellType: sanitizeString(body.upsellType, 100),
        source: sanitizeString(body.source, 100),
        location: sanitizeString(body.location, 100),
        ctaPlan: sanitizeString(body.ctaPlan, 100),
        ownerId,
        eventId: sanitizeString(body.eventId, 64),
        eventSlug: sanitizeString(body.eventSlug, 120),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[analytics/log] error:', error)
    return NextResponse.json({ error: 'Failed to log event' }, { status: 500 })
  }
}
