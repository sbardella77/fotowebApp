import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { isMuxConfigured } from '@/lib/server/mux'
import { reconcileStuckVideos } from '@/lib/server/video-uploads'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:reconcile-videos] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:reconcile-videos] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

async function runReconcile() {
  const prisma = await getPrismaClient()
  if (!prisma) return { ok: false, error: 'Database not available', status: 503 }
  if (!isMuxConfigured()) return { ok: true, skipped: 'mux_not_configured' }

  const start = Date.now()
  try {
    const stats = await reconcileStuckVideos(prisma)
    const durationMs = Date.now() - start
    console.log(`[cron:reconcile-videos] durationMs=${durationMs}`, stats)
    return { ok: true, durationMs, ...stats }
  } catch (error) {
    console.error('[cron:reconcile-videos] reconcile failed:', error?.message)
    return { ok: false, error: 'Video reconcile failed', status: 500 }
  }
}

async function handle(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const result = await runReconcile()
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json(result)
}

export async function GET(request) {
  return handle(request)
}

export async function POST(request) {
  return handle(request)
}
