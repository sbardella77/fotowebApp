import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { sendOpsAlert } from '@/lib/server/ops-alerts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Re-alerting on every poll would spam ops email if an external uptime
// monitor hits this endpoint every minute during a sustained outage — this
// throttle keeps it to at most one alert per type per window, best-effort
// (resets on cold start, since nothing here is meant to be durable state).
const ALERT_THROTTLE_MS = 15 * 60 * 1000
function shouldAlert(key) {
  globalThis.__snaproomsHealthAlertedAt ||= {}
  const last = globalThis.__snaproomsHealthAlertedAt[key]
  const now = Date.now()
  if (last && now - last < ALERT_THROTTLE_MS) return false
  globalThis.__snaproomsHealthAlertedAt[key] = now
  return true
}

export async function GET() {
  const prisma = await getPrismaClient()

  if (!prisma) {
    if (shouldAlert('db_client_unavailable')) {
      await sendOpsAlert({
        severity: 'critical',
        type: 'health:db:client_unavailable',
        title: 'Health check: Prisma client could not be initialized',
      })
    }
    return NextResponse.json(
      { status: 'unavailable', error: 'Database client not initialized' },
      { status: 503 }
    )
  }

  try {
    const start = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const connectivityDurationMs = Date.now() - start

    // Connectivity alone (SELECT 1) would not have caught the 2026-10-24
    // incident: the connection worked, but Prisma Client expected columns
    // the production DB didn't have yet. A real query against every column
    // Prisma Client currently knows about (its default, unscoped select)
    // catches exactly that class of schema drift.
    await prisma.owner.findFirst({ orderBy: { createdAt: 'desc' } })

    const durationMs = Date.now() - start
    return NextResponse.json({ status: 'ok', durationMs, connectivityDurationMs })
  } catch (error) {
    const code = error?.code || 'unknown'
    const isSchemaMismatch = code === 'P2022' || code === 'P2021' || /column .* does not exist/i.test(error?.message || '')
    const alertType = isSchemaMismatch ? 'health:db:schema_mismatch' : 'health:db:unreachable'
    console.error(`[health/db] ${isSchemaMismatch ? 'Schema mismatch' : 'Database unreachable'} code=${code}`)
    if (shouldAlert(alertType)) {
      await sendOpsAlert({
        severity: 'critical',
        type: alertType,
        title: isSchemaMismatch
          ? 'Health check: Prisma schema does not match the database'
          : 'Health check: database unreachable',
        message: error?.message,
        context: { errorCode: code },
      })
    }
    return NextResponse.json(
      { status: isSchemaMismatch ? 'schema_mismatch' : 'unavailable', error: isSchemaMismatch ? 'Database schema mismatch' : 'Database unreachable' },
      { status: 503 }
    )
  }
}
