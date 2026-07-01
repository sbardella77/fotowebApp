import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { resolveCanonicalOwner } from '@/lib/server/owner-resolution'
import { resolveSubscriptionAccessState } from '@/lib/server/subscription-lifecycle'

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

    const access = resolveSubscriptionAccessState(owner)

    return NextResponse.json({
      plan: owner.plan || 'free',
      subscriptionStatus: owner.subscriptionStatus || null,
      paymentFailedAt: owner.paymentFailedAt || null,
      subscriptionGraceUntil: owner.subscriptionGraceUntil || null,
      subscriptionCanceledAt: owner.subscriptionCanceledAt || null,
      subscriptionCancelAtPeriodEnd: owner.subscriptionCancelAtPeriodEnd || false,
      subscriptionCurrentPeriodEnd: owner.subscriptionCurrentPeriodEnd || null,
      subscriptionCancelScheduledAt: owner.subscriptionCancelScheduledAt || null,
      lastInvoiceId: owner.lastInvoiceId || null,
      lastInvoiceStatus: owner.lastInvoiceStatus || null,
      stripeCustomerId: owner.stripeCustomerId || null,
      stripeSubscriptionId: owner.stripeSubscriptionId || null,
      planUpdatedAt: owner.planUpdatedAt,
      extraEventCredits: typeof owner.extraEventCredits === 'number' ? owner.extraEventCredits : 0,
      billingWarning: access.dashboardBillingWarning,
      billingActionRequired: access.billingActionRequired,
      canManageSubscription: access.canManageSubscription,
      accountPremiumActive: access.accountPremiumActive,
      cancellationInfo: access.dashboardCancellationInfo,
    })
  } catch (error) {
    console.error('[owner/plan]', error)
    return NextResponse.json({ error: 'Unable to load plan' }, { status: 500 })
  }
}
