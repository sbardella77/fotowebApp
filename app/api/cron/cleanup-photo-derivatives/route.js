import { NextResponse } from 'next/server'
import { cleanupPhotoDerivatives } from '@/lib/server/derivative-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:cleanup-photo-derivatives] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:cleanup-photo-derivatives] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

/**
 * Reconciliation sweep for public photo derivatives.
 *
 * Deletes `derivatives/wm-v1/` and `derivatives/display-v1/` objects whose
 * Photo row is absent or not VISIBLE. Source originals are never in scope:
 * the sweep can only address pathnames the derivative builders themselves
 * produce. Response carries aggregate counters only — never photo ids or
 * filenames.
 */
async function runCleanup() {
  const start = Date.now()
  try {
    const stats = await cleanupPhotoDerivatives()
    const duration = Date.now() - start
    console.log(`[cron:cleanup-photo-derivatives] durationMs=${duration}`, stats)
    return NextResponse.json({ ok: true, durationMs: duration, ...stats })
  } catch (err) {
    console.error('[cron:cleanup-photo-derivatives] error:', err)
    try {
      await sendOpsAlert({
        severity: 'critical',
        type: 'ops:cron:photo_derivative_cleanup_failed',
        title: 'Photo derivative cleanup cron failed',
        message: err?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original cleanup failure below.
    }
    return NextResponse.json({ error: err.message || 'Cleanup failed' }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  return runCleanup()
}

export async function POST(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  return runCleanup()
}
