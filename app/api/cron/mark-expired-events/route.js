import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { resolveEventRetentionState } from '@/lib/event-retention'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

// Step 1-2 of the cleanup pipeline described in docs/retention-policy.md:
// find expired events and mark them. Steps 3-4 (notify, then destructive
// soft-delete of blobs/DB records) are deliberately NOT implemented here —
// the doc itself requires legal review before any automated deletion ships,
// and this cron never deletes or modifies anything other than this one
// reversible timestamp. Event-expiring reminder emails are a separate
// concern (notify-event-expiring cron).

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:mark-expired-events] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:mark-expired-events] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

async function runMarking() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    return { ok: false, error: 'Database not available', status: 503 }
  }

  const start = Date.now()

  try {
    const events = await prisma.event.findMany({
      where: { archiveLocked: false },
      include: { owner: true },
    })

    let marked = 0
    let unmarked = 0

    for (const event of events) {
      try {
        const state = resolveEventRetentionState({
          event,
          ownerPlan: event.owner?.plan,
          ownerSubscriptionCanceledAt: event.owner?.subscriptionCanceledAt,
        })

        if (state.isExpired && !event.expiredAt) {
          await prisma.event.update({ where: { id: event.id }, data: { expiredAt: new Date() } })
          marked += 1
        } else if (!state.isExpired && event.expiredAt) {
          // Reversal: the event is no longer expired (plan upgrade, Vault
          // extension, etc.) — keep the flag in sync with current reality
          // rather than leaving a stale marker behind.
          await prisma.event.update({ where: { id: event.id }, data: { expiredAt: null } })
          unmarked += 1
        }
      } catch (error) {
        console.error('[cron:mark-expired-events] Failed for event:', { eventId: event.id, error: error.message })
      }
    }

    const durationMs = Date.now() - start
    const stats = { scanned: events.length, marked, unmarked }
    console.log(`[cron:mark-expired-events] durationMs=${durationMs}`, stats)
    return { ok: true, durationMs, ...stats }
  } catch (error) {
    console.error('[cron:mark-expired-events] run failed')
    try {
      await sendOpsAlert({
        severity: 'warning',
        type: 'ops:cron:mark_expired_events_failed',
        title: 'Mark-expired-events cron failed',
        message: error?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original failure below.
    }
    return { ok: false, error: 'Mark-expired-events run failed', status: 500 }
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await runMarking()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { ok, durationMs, ...stats } = result
  return NextResponse.json({ ok, durationMs, ...stats })
}

export async function POST(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await runMarking()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { ok, durationMs, ...stats } = result
  return NextResponse.json({ ok, durationMs, ...stats })
}
