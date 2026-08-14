import { NextResponse } from 'next/server'
import { cleanupGalleryDownloads } from '@/lib/server/gallery-download-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:cleanup-gallery-downloads] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:cleanup-gallery-downloads] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const start = Date.now()
  try {
    const stats = await cleanupGalleryDownloads()
    const duration = Date.now() - start
    console.log(`[cron:cleanup-gallery-downloads] durationMs=${duration}`, stats)
    return NextResponse.json({ ok: true, durationMs: duration, ...stats })
  } catch (err) {
    console.error('[cron:cleanup-gallery-downloads] error:', err)
    try {
      await sendOpsAlert({
        severity: 'critical',
        type: 'ops:cron:gallery_download_cleanup_failed',
        title: 'Gallery download cleanup cron failed',
        message: err?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original cleanup failure below.
    }
    return NextResponse.json({ error: err.message || 'Cleanup failed' }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const start = Date.now()
  try {
    const stats = await cleanupGalleryDownloads()
    const duration = Date.now() - start
    console.log(`[cron:cleanup-gallery-downloads] durationMs=${duration}`, stats)
    return NextResponse.json({ ok: true, durationMs: duration, ...stats })
  } catch (err) {
    console.error('[cron:cleanup-gallery-downloads] error:', err)
    try {
      await sendOpsAlert({
        severity: 'critical',
        type: 'ops:cron:gallery_download_cleanup_failed',
        title: 'Gallery download cleanup cron failed',
        message: err?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original cleanup failure below.
    }
    return NextResponse.json({ error: err.message || 'Cleanup failed' }, { status: 500 })
  }
}
