import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://fotoweb-app.vercel.app'
const TEST_EMAIL = 'incident-test-reset@snaprooms.app'

const generateToken = () => randomBytes(32).toString('base64url')
const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const minutesFromNow = (mins) => new Date(Date.now() + mins * 60 * 1000)

async function api(method, path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  return { status: res.status, data }
}

async function cleanup() {
  const owner = await prisma.owner.findUnique({ where: { email: TEST_EMAIL } })
  if (owner) {
    await prisma.ownerPasswordResetToken.deleteMany({ where: { ownerId: owner.id } })
    await prisma.owner.delete({ where: { id: owner.id } })
    console.log('Cleaned up test owner')
  }
}

async function main() {
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
    const setupStatus = await api('GET', `/api/owner/setup?token=${encodeURIComponent(setupRaw)}`)
    console.log('Setup token status:', setupStatus.status, setupStatus.data)
    if (setupStatus.status !== 200) throw new Error('Setup token status failed')

    // 4. Setup password via API
    const setupRes = await api('POST', '/api/owner/setup', {
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

    const resetStatus = await api('GET', `/api/owner/reset-password?token=${encodeURIComponent(resetRaw)}`)
    console.log('Reset token status:', resetStatus.status, resetStatus.data)
    if (resetStatus.status !== 200) throw new Error('Reset token status failed')

    // 6. Use reset token once
    const resetRes = await api('POST', '/api/owner/reset-password', {
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
    const reuseRes = await api('POST', '/api/owner/reset-password', {
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

    const forgotRes = await api('POST', '/api/owner/forgot-password', { email: TEST_EMAIL })
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

main()
