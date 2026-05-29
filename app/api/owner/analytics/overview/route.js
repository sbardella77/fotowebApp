import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const token = request.cookies.get('snaprooms_owner_session')?.value
    const ownerEmail = await verifyOwnerSessionToken(token)
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const owner = await resolveCanonicalOwner(ownerEmail)
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    const ownerId = owner.id

    const [eventsCount, totalPhotos, premiumEvent] = await Promise.all([
      prisma.event.count({ where: { ownerId } }),
      prisma.photo.count({
        where: {
          event: { ownerId },
        },
      }),
      prisma.event.findFirst({
        where: { ownerId, billingTier: { not: null } },
        select: { billingTier: true },
      }),
    ])

    const hasPremiumEvents = !!premiumEvent
    const hasWeddingPro = premiumEvent?.billingTier === 'wedding_pro'
    const hasProEvent = premiumEvent?.billingTier === 'pro_event'

    return NextResponse.json({
      plan: owner.plan || 'free',
      eventsCount,
      totalPhotos,
      hasPremiumEvents,
      hasWeddingPro,
      hasProEvent,
    })
  } catch (error) {
    console.error('[analytics/overview] error:', error)
    return NextResponse.json({ error: 'Failed to fetch overview' }, { status: 500 })
  }
}
