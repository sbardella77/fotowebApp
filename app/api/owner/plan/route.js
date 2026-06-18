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

    return NextResponse.json({
      plan: owner.plan || 'free',
      stripeCustomerId: owner.stripeCustomerId,
      stripeSubscriptionId: owner.stripeSubscriptionId,
      planUpdatedAt: owner.planUpdatedAt,
      subscriptionCanceledAt: owner.subscriptionCanceledAt,
      extraEventCredits: owner.extraEventCredits || 0,
    })
  } catch (error) {
    console.error('[owner/plan]', error)
    return NextResponse.json({ error: 'Unable to load plan' }, { status: 500 })
  }
}
