import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getAppUrl } from '@/lib/server/event-routes'
import { sendPhotoDigestEmail } from '@/lib/server/owner-notification-emails'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:notify-photo-digest] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:notify-photo-digest] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

async function runDigest() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    return { ok: false, error: 'Database not available', status: 503 }
  }

  const start = Date.now()
  const appUrl = getAppUrl()

  try {
    const events = await prisma.event.findMany({
      where: {
        pendingDigestPhotoCount: { gt: 0 },
        owner: { emailNotificationsEnabled: true },
      },
      include: { owner: true },
    })

    let notified = 0
    let skipped = 0

    for (const event of events) {
      const countAtReadTime = event.pendingDigestPhotoCount

      try {
        const result = await sendPhotoDigestEmail({
          owner: event.owner,
          event,
          newPhotoCount: countAtReadTime,
          appUrl,
        })

        // Decrement by the amount read, not reset to zero — any photo
        // uploaded between this read and the update below stays pending
        // and is picked up by the next run instead of being lost.
        await prisma.event.update({
          where: { id: event.id },
          data: {
            pendingDigestPhotoCount: { decrement: countAtReadTime },
            lastPhotoDigestSentAt: new Date(),
          },
        })

        if (result.sent) {
          notified += 1
        } else {
          skipped += 1
        }
      } catch (error) {
        console.error('[cron:notify-photo-digest] Failed for event:', { eventId: event.id, error: error.message })
      }
    }

    const durationMs = Date.now() - start
    const stats = { scanned: events.length, notified, skipped }
    console.log(`[cron:notify-photo-digest] durationMs=${durationMs}`, stats)
    return { ok: true, durationMs, ...stats }
  } catch (error) {
    console.error('[cron:notify-photo-digest] digest run failed')
    try {
      await sendOpsAlert({
        severity: 'warning',
        type: 'ops:cron:photo_digest_failed',
        title: 'Photo digest cron failed',
        message: error?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original failure below.
    }
    return { ok: false, error: 'Photo digest run failed', status: 500 }
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await runDigest()
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

  const result = await runDigest()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { ok, durationMs, ...stats } = result
  return NextResponse.json({ ok, durationMs, ...stats })
}
