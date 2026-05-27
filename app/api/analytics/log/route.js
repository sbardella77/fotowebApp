import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'

export const dynamic = 'force-dynamic'

const VALID_EVENTS = new Set([
  'upsell_impression',
  'upsell_click',
  'upsell_checkout_start',
  'upsell_conversion',
])

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))

    if (!body.eventName || !VALID_EVENTS.has(body.eventName)) {
      return NextResponse.json({ error: 'Invalid event name' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    await prisma.upsellEvent.create({
      data: {
        eventName: body.eventName,
        upsellType: body.upsellType || null,
        source: body.source || null,
        location: body.location || null,
        ctaPlan: body.ctaPlan || null,
        ownerId: body.ownerId || null,
        eventId: body.eventId || null,
        eventSlug: body.eventSlug || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[analytics/log] error:', error)
    return NextResponse.json({ error: 'Failed to log event' }, { status: 500 })
  }
}
