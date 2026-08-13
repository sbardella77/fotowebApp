import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'

// admin-auth.js pulls in admin-credential-store.js (fs/prisma access) as a
// side effect of its import graph, but getSessionSecret() no longer calls
// into the credential store at all. Mock fs/promises and the prisma client
// so the module graph loads cleanly without touching disk/DB.
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
  getPrismaClient: vi.fn().mockResolvedValue(null),
}))

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

describe('admin-auth session secret hardening', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    delete process.env.ADMIN_SESSION_SECRET
    delete process.env.ADMIN_PASSWORD
  })

  afterEach(() => {
    restoreEnv()
  })

  // --- A. Secret present: create + verify round-trip works ---

  it('creates and verifies a token when ADMIN_SESSION_SECRET is set', async () => {
    process.env.ADMIN_SESSION_SECRET = 'a'.repeat(40)
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const token = await createAdminSessionToken()
    expect(await verifyAdminSessionToken(token)).toBe(true)
  })

  // --- B. Secret absent: create/verify must fail explicitly ---

  it('throws explicitly on create when ADMIN_SESSION_SECRET is missing', async () => {
    const { createAdminSessionToken } = await import('@/lib/server/admin-auth')
    await expect(createAdminSessionToken()).rejects.toThrow('ADMIN_SESSION_SECRET')
  })

  it('throws explicitly on verify when ADMIN_SESSION_SECRET is missing', async () => {
    const { verifyAdminSessionToken } = await import('@/lib/server/admin-auth')
    // Even a well-formed token must not be accepted; the secret lookup itself
    // must fail before any comparison happens.
    await expect(verifyAdminSessionToken('payload.signature')).rejects.toThrow('ADMIN_SESSION_SECRET')
  })

  // --- C. ADMIN_PASSWORD and ADMIN_SESSION_SECRET differ: password never influences the signature ---

  it('ignores ADMIN_PASSWORD entirely when signing/verifying', async () => {
    process.env.ADMIN_SESSION_SECRET = 'b'.repeat(40)
    process.env.ADMIN_PASSWORD = 'super-secret-admin-password'
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const token = await createAdminSessionToken()
    expect(await verifyAdminSessionToken(token)).toBe(true)

    // A token forged using ADMIN_PASSWORD as the HMAC key must not verify.
    const [encodedPayload] = token.split('.')
    const forgedSignature = createHmac('sha256', process.env.ADMIN_PASSWORD).update(encodedPayload).digest('hex')
    expect(await verifyAdminSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(false)
  })

  // --- D. Changing ADMIN_PASSWORD after issuing a token does not invalidate it ---

  it('keeps a previously issued token valid after ADMIN_PASSWORD changes', async () => {
    process.env.ADMIN_SESSION_SECRET = 'c'.repeat(40)
    process.env.ADMIN_PASSWORD = 'old-password'
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const token = await createAdminSessionToken()

    process.env.ADMIN_PASSWORD = 'brand-new-password'
    expect(await verifyAdminSessionToken(token)).toBe(true)
  })

  // --- E/F/G. Tokens forged with the old derivation schemes must be rejected ---

  it('rejects a token signed with sha256(ADMIN_PASSWORD)', async () => {
    process.env.ADMIN_SESSION_SECRET = 'd'.repeat(40)
    process.env.ADMIN_PASSWORD = 'whatever-password'
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const validToken = await createAdminSessionToken()
    const [encodedPayload] = validToken.split('.')

    const legacySecret = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyAdminSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(false)
  })

  it('rejects a token signed with sha256(passwordHash)', async () => {
    process.env.ADMIN_SESSION_SECRET = 'e'.repeat(40)
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const validToken = await createAdminSessionToken()
    const [encodedPayload] = validToken.split('.')

    const fakePasswordHash = 'deadbeef'.repeat(8)
    const legacySecret = createHash('sha256').update(fakePasswordHash).digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyAdminSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(false)
  })

  it("rejects a token signed with sha256('snaprooms-admin-fallback')", async () => {
    process.env.ADMIN_SESSION_SECRET = 'f'.repeat(40)
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const validToken = await createAdminSessionToken()
    const [encodedPayload] = validToken.split('.')

    const legacySecret = createHash('sha256').update('snaprooms-admin-fallback').digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyAdminSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(false)
  })

  // --- H. Token signed with a wrong ADMIN_SESSION_SECRET is rejected ---

  it('rejects a token signed with an incorrect ADMIN_SESSION_SECRET', async () => {
    process.env.ADMIN_SESSION_SECRET = 'correct-secret-'.repeat(3)
    const { createAdminSessionToken, verifyAdminSessionToken } = await import('@/lib/server/admin-auth')

    const token = await createAdminSessionToken()
    const [encodedPayload] = token.split('.')

    const wrongSignature = createHmac('sha256', 'wrong-secret-'.repeat(3)).update(encodedPayload).digest('hex')
    expect(await verifyAdminSessionToken(`${encodedPayload}.${wrongSignature}`)).toBe(false)
  })
})
