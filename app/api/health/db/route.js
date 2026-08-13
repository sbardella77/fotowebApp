import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const prisma = await getPrismaClient()

  if (!prisma) {
    return NextResponse.json(
      { status: 'unavailable', error: 'Database client not initialized' },
      { status: 503 }
    )
  }

  try {
    const start = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const durationMs = Date.now() - start
    return NextResponse.json({ status: 'ok', durationMs })
  } catch (error) {
    const code = error?.code || 'unknown'
    console.error(`[health/db] Database unreachable code=${code}`)
    return NextResponse.json(
      { status: 'unavailable', error: 'Database unreachable' },
      { status: 503 }
    )
  }
}
