import { NextResponse } from 'next/server'
import { differenceInDays } from 'date-fns'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getAppUrl } from '@/lib/server/event-routes'
import { resolveEventRetentionState } from '@/lib/event-retention'
import { sendEventExpiringReminderEmail } from '@/lib/server/owner-notification-emails'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:notify-event-expiring] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:notify-event-expiring] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

// Picks the most urgent threshold that hasn't fired yet for this event, so
// an event that was never checked while far from expiry (e.g. after a
// subscription cancellation shortens its grace period abruptly) still gets
// exactly one reminder instead of all three on the same run.
function resolveNextReminderStage(event, daysRemaining) {
  if (daysRemaining <= 0 && !event.retentionReminderT0SentAt) return { stage: 'T0', field: 'retentionReminderT0SentAt' }
  if (daysRemaining <= 7 && !event.retentionReminderT7SentAt) return { stage: 'T7', field: 'retentionReminderT7SentAt' }
  if (daysRemaining <= 30 && !event.retentionReminderT30SentAt) return { stage: 'T30', field: 'retentionReminderT30SentAt' }
  return null
}

async function runReminders() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    return { ok: false, error: 'Database not available', status: 503 }
  }

  const start = Date.now()
  const appUrl = getAppUrl()

  try {
    const events = await prisma.event.findMany({
      where: {
        archiveLocked: false,
        ownerId: { not: null },
        owner: { emailNotificationsEnabled: true },
      },
      include: { owner: true },
    })

    let notified = 0
    let skipped = 0

    for (const event of events) {
      try {
        const state = resolveEventRetentionState({
          event,
          ownerPlan: event.owner.plan,
          ownerSubscriptionCanceledAt: event.owner.subscriptionCanceledAt,
        })

        // No expiration to warn about (archived, or an owner plan that
        // covers this event indefinitely).
        if (!state.retentionUntil) continue

        const daysRemaining = Math.max(0, differenceInDays(state.retentionUntil, new Date()))
        const next = resolveNextReminderStage(event, daysRemaining)
        if (!next) continue

        const result = await sendEventExpiringReminderEmail({
          owner: event.owner,
          event,
          daysRemaining,
          appUrl,
        })

        await prisma.event.update({
          where: { id: event.id },
          data: { [next.field]: new Date() },
        })

        if (result.sent) {
          notified += 1
        } else {
          skipped += 1
        }
      } catch (error) {
        console.error('[cron:notify-event-expiring] Failed for event:', { eventId: event.id, error: error.message })
      }
    }

    const durationMs = Date.now() - start
    const stats = { scanned: events.length, notified, skipped }
    console.log(`[cron:notify-event-expiring] durationMs=${durationMs}`, stats)
    return { ok: true, durationMs, ...stats }
  } catch (error) {
    console.error('[cron:notify-event-expiring] run failed')
    try {
      await sendOpsAlert({
        severity: 'warning',
        type: 'ops:cron:event_expiring_failed',
        title: 'Event-expiring reminder cron failed',
        message: error?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original failure below.
    }
    return { ok: false, error: 'Event-expiring reminder run failed', status: 500 }
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await runReminders()
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

  const result = await runReminders()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { ok, durationMs, ...stats } = result
  return NextResponse.json({ ok, durationMs, ...stats })
}
