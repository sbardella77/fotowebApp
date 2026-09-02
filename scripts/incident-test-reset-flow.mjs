#!/usr/bin/env node
/**
 * SnapRooms — Incident test: owner password setup + reset token flow.
 *
 * Exercises the live setup/reset-password API against a dedicated,
 * disposable test owner. Creates and deletes real rows for that identity
 * only. Development/Preview only — refuses to run against Production.
 *
 * Usage:
 *   APP_URL=<preview-or-local-url> INCIDENT_TEST_ENV=development node scripts/incident-test-reset-flow.mjs --execute
 *
 * Without --execute, prints the planned steps and exits without touching
 * the database or making network calls.
 *
 * Environment (all required to --execute; never logged):
 *   APP_URL           — target app origin. Must not resolve to the
 *                        production host (snaprooms.app or a subdomain).
 *   INCIDENT_TEST_ENV — must be exactly "development" or "preview".
 *   DATABASE_URL      — required by Prisma; must point at a non-Production
 *                        database matching the declared INCIDENT_TEST_ENV.
 *
 * Exit codes:
 *   0 — dry run printed, or flow completed successfully
 *   1 — safety guard failed, or flow failed (test data is still cleaned up)
 */
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

export const PRODUCTION_HOSTNAME = 'snaprooms.app'
export const TEST_EMAIL = 'incident-test-reset@snaprooms.app'
export const ALLOWED_ENV_VALUES = new Set(['development', 'preview'])

export function shouldExecute(argv) {
  return argv.includes('--execute')
}

// Pure guards: return { ok, value|error } instead of exiting, so tests can
// exercise the safety contract without a process-exit or side effect.
export function checkAppUrl(env) {
  const appUrl = env.APP_URL
  if (!appUrl) {
    return { ok: false, error: 'Missing APP_URL. Refusing to run incident reset flow.' }
  }

  let hostname
  try {
    hostname = new URL(appUrl).hostname
  } catch {
    return { ok: false, error: `APP_URL is not a valid URL: ${appUrl}` }
  }

  if (hostname === PRODUCTION_HOSTNAME || hostname.endsWith(`.${PRODUCTION_HOSTNAME}`)) {
    return {
      ok: false,
      error: `APP_URL resolves to a production host (${hostname}). Refusing to run incident reset flow against Production.`,
    }
  }

  return { ok: true, value: appUrl }
}

export function checkEnv(env) {
  if (env.NODE_ENV === 'production') {
    return { ok: false, error: 'NODE_ENV is "production". Refusing to run incident reset flow.' }
  }

  const declaredEnv = env.INCIDENT_TEST_ENV
  if (!ALLOWED_ENV_VALUES.has(declaredEnv)) {
    return {
      ok: false,
      error:
        'INCIDENT_TEST_ENV must be explicitly set to "development" or "preview" to run this script ' +
        `(got: ${declaredEnv === undefined ? '(unset)' : JSON.stringify(declaredEnv)}).`,
    }
  }

  return { ok: true }
}

function fail(message) {
  console.error(`[incident-test-reset-flow] ${message}`)
  process.exit(1)
}

const generateToken = () => randomBytes(32).toString('base64url')
const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const minutesFromNow = (mins) => new Date(Date.now() + mins * 60 * 1000)

let prismaClient = null
function getPrisma() {
  if (!prismaClient) {
    prismaClient = new PrismaClient()
  }
  return prismaClient
}

async function api(appUrl, method, path, body) {
  const res = await fetch(`${appUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  return { status: res.status, data }
}

async function cleanup() {
  const prisma = getPrisma()
  const owner = await prisma.owner.findUnique({ where: { email: TEST_EMAIL } })
  if (owner) {
    await prisma.ownerPasswordResetToken.deleteMany({ where: { ownerId: owner.id } })
    await prisma.owner.delete({ where: { id: owner.id } })
    console.log('Cleaned up test owner')
  }
}

function printPlan(appUrl) {
  console.log('[incident-test-reset-flow] Dry run (no --execute flag). No data will be created, mutated, or deleted.')
  console.log(`[incident-test-reset-flow] Target APP_URL: ${appUrl}`)
  console.log(`[incident-test-reset-flow] Test identity: ${TEST_EMAIL}`)
  console.log('[incident-test-reset-flow] Planned steps if run with --execute:')
  console.log('  1. Delete any pre-existing test owner + reset tokens for the test identity (cleanup)')
  console.log('  2. Create a test Owner without a password')
  console.log('  3. Generate + insert a password-setup token, verify it via GET /api/owner/setup')
  console.log('  4. Complete password setup via POST /api/owner/setup')
  console.log('  5. Generate + insert a password-reset token, verify it via GET /api/owner/reset-password')
  console.log('  6. Use the reset token once via POST /api/owner/reset-password')
  console.log('  7. Confirm reuse of the same token is rejected (expects 400)')
  console.log('  8. Request /api/owner/forgot-password and confirm the previous unused token is invalidated')
  console.log('  9. Delete the test owner + reset tokens (cleanup)')
  console.log('[incident-test-reset-flow] Re-run with --execute to perform these operations.')
}

async function runFlow(appUrl) {
  const prisma = getPrisma()
  try {
    await cleanup()

    // 1. Create test owner without password
    const owner = await prisma.owner.create({
      data: { email: TEST_EMAIL },
    })
    console.log('Created test owner:', owner.id)

    // 2. Generate setup token and insert into DB
    const setupRaw = generateToken()
    await prisma.ownerPasswordResetToken.create({
      data: {
        ownerId: owner.id,
        tokenHash: hashToken(setupRaw),
        purpose: 'setup_password',
        expiresAt: minutesFromNow(60 * 24),
      },
    })

    // 3. Validate setup token status
    const setupStatus = await api(appUrl, 'GET', `/api/owner/setup?token=${encodeURIComponent(setupRaw)}`)
    console.log('Setup token status:', setupStatus.status, setupStatus.data)
    if (setupStatus.status !== 200) throw new Error('Setup token status failed')

    // 4. Setup password via API
    const setupRes = await api(appUrl, 'POST', '/api/owner/setup', {
      token: setupRaw,
      password: 'TestPass123!',
    })
    console.log('Setup password:', setupRes.status, setupRes.data)
    if (setupRes.status !== 200) throw new Error('Setup password failed')

    const ownerAfterSetup = await prisma.owner.findUnique({ where: { id: owner.id } })
    console.log('Owner sessionVersion after setup:', ownerAfterSetup.sessionVersion)

    // 5. Generate reset token and insert into DB
    const resetRaw = generateToken()
    await prisma.ownerPasswordResetToken.create({
      data: {
        ownerId: owner.id,
        tokenHash: hashToken(resetRaw),
        purpose: 'password_reset',
        expiresAt: minutesFromNow(30),
      },
    })

    const resetStatus = await api(appUrl, 'GET', `/api/owner/reset-password?token=${encodeURIComponent(resetRaw)}`)
    console.log('Reset token status:', resetStatus.status, resetStatus.data)
    if (resetStatus.status !== 200) throw new Error('Reset token status failed')

    // 6. Use reset token once
    const resetRes = await api(appUrl, 'POST', '/api/owner/reset-password', {
      token: resetRaw,
      password: 'NewPass456!',
    })
    console.log('Reset password:', resetRes.status, resetRes.data)
    if (resetRes.status !== 200) throw new Error('Reset password failed')

    const tokenAfterUse = await prisma.ownerPasswordResetToken.findFirst({
      where: { ownerId: owner.id, purpose: 'password_reset', tokenHash: hashToken(resetRaw) },
    })
    console.log('Token usedAt after first reset:', tokenAfterUse.usedAt)
    if (!tokenAfterUse.usedAt) throw new Error('Token was not marked used')

    const ownerAfterReset = await prisma.owner.findUnique({ where: { id: owner.id } })
    console.log('Owner sessionVersion after reset:', ownerAfterReset.sessionVersion)
    if (ownerAfterReset.sessionVersion <= ownerAfterSetup.sessionVersion) throw new Error('sessionVersion did not increment')

    // 7. Reuse same token - must fail
    const reuseRes = await api(appUrl, 'POST', '/api/owner/reset-password', {
      token: resetRaw,
      password: 'AnotherPass789!',
    })
    console.log('Reuse used token:', reuseRes.status, reuseRes.data)
    if (reuseRes.status !== 400) throw new Error('Reusing used token should fail with 400')

    // 8. Create another unused reset token, then request forgot-password for the same owner
    const staleRaw = generateToken()
    await prisma.ownerPasswordResetToken.create({
      data: {
        ownerId: owner.id,
        tokenHash: hashToken(staleRaw),
        purpose: 'password_reset',
        expiresAt: minutesFromNow(30),
      },
    })

    const forgotRes = await api(appUrl, 'POST', '/api/owner/forgot-password', { email: TEST_EMAIL })
    console.log('Forgot password:', forgotRes.status, forgotRes.data)
    if (forgotRes.status !== 200) throw new Error('Forgot password failed')

    const staleToken = await prisma.ownerPasswordResetToken.findFirst({
      where: { ownerId: owner.id, tokenHash: hashToken(staleRaw) },
    })
    console.log('Stale token usedAt after new forgot request:', staleToken?.usedAt)
    if (!staleToken?.usedAt) throw new Error('Previous unused token was not invalidated')

    console.log('\n✅ Reset password security flow verified')
  } catch (error) {
    console.error('\n❌ Flow test failed:', error.message)
    process.exitCode = 1
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

async function main() {
  const envCheck = checkEnv(process.env)
  if (!envCheck.ok) fail(envCheck.error)

  const appUrlCheck = checkAppUrl(process.env)
  if (!appUrlCheck.ok) fail(appUrlCheck.error)

  const appUrl = appUrlCheck.value

  if (!shouldExecute(process.argv)) {
    printPlan(appUrl)
    return
  }

  await runFlow(appUrl)
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main()
}
