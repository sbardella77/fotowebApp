/**
 * SnapRooms — Extra Free Event checkout reconciliation (BILLING PR 2A).
 *
 * READ-ONLY DIAGNOSTIC ROUTE. There is no apply/mutation mode in this PR —
 * this endpoint calls inspectExtraFreeEventCheckouts (which cannot write
 * anything — see lib/server/extra-free-event-reconciliation.js) and returns
 * its aggregate result verbatim. It performs zero DB writes, zero Stripe
 * mutations, zero fulfillment, zero webhook replay.
 *
 * Deliberately NOT present in vercel.json — this route is deployed but
 * unscheduled, so merging/deploying this PR triggers zero Stripe calls and
 * zero DB reads on its own. It only runs when explicitly invoked.
 *
 * Auth: `CRON_SECRET` env var, sent as `Authorization: Bearer <token>`
 *       or `X-Cron-Secret: <token>` — same convention as every other cron
 *       route in this project (see app/api/cron/check-billing-health).
 */

import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getStripe } from '@/lib/server/stripe'
import { inspectExtraFreeEventCheckouts } from '@/lib/server/extra-free-event-reconciliation'

export const dynamic = 'force-dynamic'

function getCronSecret(request) {
  const auth = request.headers.get('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return request.headers.get('x-cron-secret') || ''
}

export async function GET(request) {
  const secret = getCronSecret(request)
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.error('[cron/reconcile-extra-free-event-checkouts] Database unavailable')
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  let stripe
  try {
    stripe = getStripe()
  } catch (error) {
    console.error('[cron/reconcile-extra-free-event-checkouts] Stripe unavailable:', error.message)
    return NextResponse.json({ error: 'Stripe unavailable' }, { status: 503 })
  }

  try {
    const result = await inspectExtraFreeEventCheckouts({ prisma, stripe })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[cron/reconcile-extra-free-event-checkouts] Inspection failed:', error.message)
    return NextResponse.json({ error: 'Reconciliation inspection failed' }, { status: 500 })
  }
}
