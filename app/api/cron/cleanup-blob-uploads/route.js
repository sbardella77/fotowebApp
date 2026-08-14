import { NextResponse } from 'next/server'
import { head } from '@vercel/blob'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { deleteStoredFile } from '@/lib/server/storage'
import { cleanupBlobUploadSessions } from '@/lib/server/blob-upload-cleanup'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const dynamic = 'force-dynamic'

function verifyCronAuth(request) {
  const secret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!secret) {
    console.error('[cron:cleanup-blob-uploads] CRON_SECRET not configured')
    return { ok: false, error: 'CRON_SECRET not configured', status: 503 }
  }

  const token = authHeader?.replace('Bearer ', '')
  if (!token || token !== secret) {
    console.warn('[cron:cleanup-blob-uploads] Unauthorized attempt')
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  return { ok: true }
}

async function runCleanup() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    return { ok: false, error: 'Database not available', status: 503 }
  }

  const start = Date.now()
  try {
    const stats = await cleanupBlobUploadSessions({
      prisma,
      headBlob: (pathname) => head(pathname),
      deleteBlob: (url) => deleteStoredFile(url),
    })
    const durationMs = Date.now() - start
    console.log(`[cron:cleanup-blob-uploads] durationMs=${durationMs}`, stats)
    return { ok: true, durationMs, ...stats }
  } catch (error) {
    console.error('[cron:cleanup-blob-uploads] cleanup failed')
    try {
      await sendOpsAlert({
        severity: 'critical',
        type: 'ops:cron:blob_upload_cleanup_failed',
        title: 'Blob upload cleanup cron failed',
        message: error?.message || 'Unknown error',
        context: { durationMs: Date.now() - start },
      })
    } catch {
      // Alerting must never mask the original cleanup failure below.
    }
    return { ok: false, error: 'Blob upload cleanup failed', status: 500 }
  }
}

export async function GET(request) {
  const auth = verifyCronAuth(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await runCleanup()
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

  const result = await runCleanup()
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { ok, durationMs, ...stats } = result
  return NextResponse.json({ ok, durationMs, ...stats })
}
