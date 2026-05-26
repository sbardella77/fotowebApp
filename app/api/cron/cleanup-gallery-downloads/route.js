import { NextResponse } from 'next/server'
import { cleanupGalleryDownloads } from '@/lib/server/gallery-download-cleanup'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:cleanup-gallery-downloads] CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:cleanup-gallery-downloads] Unauthorized attempt')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  try {
    const stats = await cleanupGalleryDownloads()
    const duration = Date.now() - start
    console.log(`[cron:cleanup-gallery-downloads] durationMs=${duration}`, stats)
    return NextResponse.json({ ok: true, durationMs: duration, ...stats })
  } catch (err) {
    console.error('[cron:cleanup-gallery-downloads] error:', err)
    return NextResponse.json({ error: err.message || 'Cleanup failed' }, { status: 500 })
  }
}
