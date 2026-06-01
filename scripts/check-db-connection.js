#!/usr/bin/env node
/**
 * SnapRooms — Database connectivity check script.
 *
 * Usage:
 *   node scripts/check-db-connection.js
 *
 * Environment:
 *   DATABASE_URL — required. Connection string is never logged.
 *
 * Exit codes:
 *   0 — database reachable, SELECT 1 succeeded
 *   1 — connection failed or timed out
 */

const { PrismaClient } = require('@prisma/client')

const TIMEOUT_MS = Number(process.env.DB_HEALTH_TIMEOUT_MS) || 10000

async function check() {
  if (!process.env.DATABASE_URL) {
    console.error('[check-db] DATABASE_URL is not set')
    process.exit(1)
  }

  const prisma = new PrismaClient({
    log: [],
  })

  const start = Date.now()

  try {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), TIMEOUT_MS)
    })

    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      timeout,
    ])

    const durationMs = Date.now() - start
    console.log(`[check-db] Database connection OK (durationMs=${durationMs})`)
    await prisma.$disconnect()
    process.exit(0)
  } catch (error) {
    const durationMs = Date.now() - start
    const safeMessage = error?.message
      ? String(error.message).replace(/\b\w+:\/\/[^\s]+/g, '[REDACTED]')
      : 'unknown'
    console.error(`[check-db] Database connection failed (durationMs=${durationMs}): ${safeMessage}`)
    await prisma.$disconnect().catch(() => {})
    process.exit(1)
  }
}

check()
