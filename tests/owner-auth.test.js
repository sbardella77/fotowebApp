import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash, createHmac } from 'crypto'

const ownerRecord = { id: 'owner-1', email: 'owner@example.com', sessionVersion: 0 }

const findUniqueMock = vi.fn(async ({ where }) => {
  if (where?.email === ownerRecord.email) {
    return { id: ownerRecord.id, email: ownerRecord.email, sessionVersion: ownerRecord.sessionVersion }
  }
  return null
})

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn().mockResolvedValue({
    owner: { findUnique: (...args) => findUniqueMock(...args) },
  }),
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

describe('owner-auth session secret hardening', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    delete process.env.OWNER_SESSION_SECRET
    delete process.env.ADMIN_SESSION_SECRET
    delete process.env.ADMIN_PASSWORD
    ownerRecord.sessionVersion = 0
    findUniqueMock.mockClear()
  })

  afterEach(() => {
    restoreEnv()
  })

  // --- A. Secret present: create + verify round-trip works ---

  it('creates and verifies a token when OWNER_SESSION_SECRET is set', async () => {
    process.env.OWNER_SESSION_SECRET = 'a'.repeat(40)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const token = await createOwnerSessionToken(ownerRecord)
    expect(await verifyOwnerSessionToken(token)).toBe(ownerRecord.email)
  })

  // --- B. Secret absent: create/verify must fail explicitly ---

  it('throws explicitly on create when OWNER_SESSION_SECRET is missing', async () => {
    const { createOwnerSessionToken } = await import('@/lib/server/owner-auth')
    await expect(createOwnerSessionToken(ownerRecord)).rejects.toThrow('OWNER_SESSION_SECRET')
  })

  it('throws explicitly on verify when OWNER_SESSION_SECRET is missing', async () => {
    const { verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')
    await expect(verifyOwnerSessionToken('payload.signature')).rejects.toThrow('OWNER_SESSION_SECRET')
  })

  // --- C. ADMIN_SESSION_SECRET present but OWNER_SESSION_SECRET absent: must fail, must not fall back ---

  it('fails when only ADMIN_SESSION_SECRET is set, without using it as a fallback', async () => {
    process.env.ADMIN_SESSION_SECRET = 'admin-secret-'.repeat(3)
    const { createOwnerSessionToken } = await import('@/lib/server/owner-auth')
    await expect(createOwnerSessionToken(ownerRecord)).rejects.toThrow('OWNER_SESSION_SECRET')
  })

  // --- D. Token signed with ADMIN_SESSION_SECRET rejected when OWNER_SESSION_SECRET differs ---

  it('rejects a token signed with ADMIN_SESSION_SECRET', async () => {
    process.env.OWNER_SESSION_SECRET = 'owner-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const validToken = await createOwnerSessionToken(ownerRecord)
    const [encodedPayload] = validToken.split('.')

    const adminSecret = 'admin-secret-'.repeat(3)
    const forgedSignature = createHmac('sha256', adminSecret).update(encodedPayload).digest('hex')

    expect(await verifyOwnerSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(null)
  })

  // --- E. Token signed with sha256(ADMIN_PASSWORD) rejected ---

  it('rejects a token signed with sha256(ADMIN_PASSWORD)', async () => {
    process.env.OWNER_SESSION_SECRET = 'owner-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const validToken = await createOwnerSessionToken(ownerRecord)
    const [encodedPayload] = validToken.split('.')

    const legacySecret = createHash('sha256').update('whatever-admin-password').digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyOwnerSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(null)
  })

  // --- F. Token signed with sha256(passwordHash admin) rejected ---

  it('rejects a token signed with sha256(admin passwordHash)', async () => {
    process.env.OWNER_SESSION_SECRET = 'owner-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const validToken = await createOwnerSessionToken(ownerRecord)
    const [encodedPayload] = validToken.split('.')

    const fakeAdminPasswordHash = 'deadbeef'.repeat(8)
    const legacySecret = createHash('sha256').update(fakeAdminPasswordHash).digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyOwnerSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(null)
  })

  // --- G. Token signed with sha256('snaprooms-owner-fallback') rejected ---

  it("rejects a token signed with sha256('snaprooms-owner-fallback')", async () => {
    process.env.OWNER_SESSION_SECRET = 'owner-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const validToken = await createOwnerSessionToken(ownerRecord)
    const [encodedPayload] = validToken.split('.')

    const legacySecret = createHash('sha256').update('snaprooms-owner-fallback').digest('hex')
    const forgedSignature = createHmac('sha256', legacySecret).update(encodedPayload).digest('hex')

    expect(await verifyOwnerSessionToken(`${encodedPayload}.${forgedSignature}`)).toBe(null)
  })

  // --- H. Token signed with a wrong OWNER_SESSION_SECRET rejected ---

  it('rejects a token signed with an incorrect OWNER_SESSION_SECRET', async () => {
    process.env.OWNER_SESSION_SECRET = 'correct-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const token = await createOwnerSessionToken(ownerRecord)
    const [encodedPayload] = token.split('.')

    const wrongSignature = createHmac('sha256', 'wrong-secret-'.repeat(3)).update(encodedPayload).digest('hex')
    expect(await verifyOwnerSessionToken(`${encodedPayload}.${wrongSignature}`)).toBe(null)
  })

  // --- I. sessionVersion: valid against current DB version, rejected after DB increments ---

  it('accepts a token matching the current DB sessionVersion and rejects it after increment', async () => {
    process.env.OWNER_SESSION_SECRET = 'owner-secret-'.repeat(3)
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    const tokenBeforeReset = await createOwnerSessionToken(ownerRecord)
    expect(await verifyOwnerSessionToken(tokenBeforeReset)).toBe(ownerRecord.email)

    // Simulate a password reset incrementing sessionVersion in the DB.
    ownerRecord.sessionVersion += 1

    expect(await verifyOwnerSessionToken(tokenBeforeReset)).toBe(null)

    const tokenAfterReset = await createOwnerSessionToken(ownerRecord)
    expect(await verifyOwnerSessionToken(tokenAfterReset)).toBe(ownerRecord.email)
  })
})
