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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const prisma = await getPrismaClient()
    if (!prisma) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    const owner = await resolveCanonicalOwner(ownerEmail)
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    const ownerId = owner.id

    const [byEventName, byUpsellType, bySource, byCtaPlan] = await Promise.all([
      prisma.upsellEvent.groupBy({
        by: ['eventName'],
        where: { ownerId, createdAt: { gte: startDate } },
        _count: { id: true },
      }),
      prisma.upsellEvent.groupBy({
        by: ['upsellType', 'eventName'],
        where: { ownerId, createdAt: { gte: startDate } },
        _count: { id: true },
      }),
      prisma.upsellEvent.groupBy({
        by: ['source', 'eventName'],
        where: { ownerId, createdAt: { gte: startDate } },
        _count: { id: true },
      }),
      prisma.upsellEvent.groupBy({
        by: ['ctaPlan', 'eventName'],
        where: { ownerId, createdAt: { gte: startDate } },
        _count: { id: true },
      }),
    ])

    return NextResponse.json({
      byEventName,
      byUpsellType,
      bySource,
      byCtaPlan,
      days,
    })
  } catch (error) {
    console.error('[analytics/upsells] error:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
