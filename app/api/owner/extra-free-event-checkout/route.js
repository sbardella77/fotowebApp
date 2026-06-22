import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { verifyOwnerSessionToken } from '@/lib/server/owner-auth'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const token = request.cookies.get('snaprooms_owner_session')?.value
  const ownerEmail = await verifyOwnerSessionToken(token)
  if (!ownerEmail) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.error('[api/owner/extra-free-event-checkout] Database unavailable')
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const { resolveCanonicalOwner } = await import('@/lib/server/owner-resolution')
  const owner = await resolveCanonicalOwner(ownerEmail)
  if (!owner) {
    return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
  }

  const pending = await prisma.extraFreeEventCheckout.findFirst({
    where: { stripeCheckoutSessionId: sessionId },
  })
  if (!pending || pending.ownerId !== owner.id) {
    return NextResponse.json({ error: 'Checkout record not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: pending.status,
    eventSlug: pending.createdEventSlug || null,
    eventName: pending.eventName,
    fallbackCreditAvailable: pending.status === 'failed' && owner.extraEventCredits > 0,
  })
}
