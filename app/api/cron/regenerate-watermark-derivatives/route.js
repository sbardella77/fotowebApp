import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { runWatermarkRegeneration } from '@/lib/server/watermark-regeneration'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:regenerate-watermark-derivatives] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:regenerate-watermark-derivatives] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

/**
 * Renders the photographer-watermark display derivative for existing photos
 * of owners whose watermark changed (regenState PENDING). Cheap no-op when
 * nothing is pending. Response carries aggregate counters only.
 */
async function runRegeneration() {
  const start = Date.now()
  try {
    const prisma = await getPrismaClient()
    if (!prisma) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    const stats = await runWatermarkRegeneration({ prisma })
    const duration = Date.now() - start
    console.log(`[cron:regenerate-watermark-derivatives] durationMs=${duration}`, stats)
    return NextResponse.json({ ok: true, durationMs: duration, ...stats })
  } catch (err) {
    console.error('[cron:regenerate-watermark-derivatives] error:', err)
    try {
      await sendOpsAlert({
        severity: 'warning',
        type: 'ops:cron:watermark_regeneration_failed',
        title: 'Watermark regeneration cron failed',
        message: err?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original failure below.
    }
    return NextResponse.json({ error: err.message || 'Regeneration failed' }, { status: 500 })
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  return runRegeneration()
}

export async function POST(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  return runRegeneration()
}
