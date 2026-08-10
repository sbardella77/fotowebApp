import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ─── Static regression: loginOwner must forward the real Owner object ────────
//
// Root cause: setOwnerSessionCookie(response, ownerOrEmail) → createOwnerSessionToken
// only carries the real DB sessionVersion when it receives the Owner object.
// When given a bare email string it silently defaults sessionVersion to 0
// (see getOwnerEmailAndSessionVersion in lib/server/owner-auth.js). loginOwner
// (POST /api/owner/session) used to pass the email string on both the
// password branch and the management-token branch, so any owner whose
// sessionVersion in the DB was >= 1 (i.e. had ever reset/set a password)
// received a cookie that failed verification on the very next request.

const routeSrc = readFileSync(
  resolve(import.meta.dirname, '../app/api/[[...path]]/route.js'),
  'utf8',
)

function extractLoginOwner(source) {
  const start = source.indexOf("const loginOwner = withTiming('loginOwner'")
  if (start === -1) return ''
  const end = source.indexOf('\nconst logoutOwner', start + 1)
  return end === -1 ? source.slice(start) : source.slice(start, end)
}

const loginOwnerSrc = extractLoginOwner(routeSrc)

describe('route.js static regression — loginOwner sessionVersion fix', () => {
  it('extracted the loginOwner function body', () => {
    expect(loginOwnerSrc.length).toBeGreaterThan(0)
  })

  it('does not pass the bare email string to setOwnerSessionCookie anywhere', () => {
    expect(loginOwnerSrc).not.toMatch(/setOwnerSessionCookie\(\s*response\s*,\s*email\s*\)/)
  })

  it('password branch forwards the resolved owner object', () => {
    expect(loginOwnerSrc).toMatch(/const owner = await findOwnerByEmailWithPassword\([\s\S]*?setOwnerSessionCookie\(response, owner\)/)
  })

  it('management-token branch resolves the canonical owner before issuing a session', () => {
    expect(loginOwnerSrc).toMatch(/const owner = await resolveCanonicalOwner\(email\)/)
    expect(loginOwnerSrc).toMatch(/setOwnerSessionCookie\(response, owner\)/)
  })

  it('management-token branch refuses to authenticate when no owner can be resolved', () => {
    // resolveCanonicalOwner(email) returns null when Prisma is unavailable or
    // when no Owner row exists for this email — in either case the endpoint
    // must not report authenticated:true or set an unverifiable cookie.
    expect(loginOwnerSrc).toMatch(/if \(!owner\) \{[\s\S]*?return jsonPrivate\(\{ error:[^}]*\}, 503\)/)
    expect(loginOwnerSrc).not.toMatch(/owner \|\| email/)
  })
})

// ─── Behavioral regression: the resulting owner object round-trips sessionVersion ──
//
// These exercise the exact underlying mechanism loginOwner now relies on
// (createOwnerSessionToken/verifyOwnerSessionToken with an Owner-shaped
// object), for owners at sessionVersion 0, 1, and > 1, and confirm a DB
// increment invalidates a previously issued token — mirroring what both the
// password and management-token branches of POST /api/owner/session do
// after this fix.

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

describe('owner session sessionVersion behavior after loginOwner fix', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
    ownerRecord.sessionVersion = 0
    findUniqueMock.mockClear()
  })

  afterEach(() => {
    restoreEnv()
  })

  // --- A. sessionVersion = 0: login → verifiable token ---

  it('issues a verifiable token for an owner with sessionVersion 0', async () => {
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    ownerRecord.sessionVersion = 0
    const token = await createOwnerSessionToken(ownerRecord)
    expect(await verifyOwnerSessionToken(token)).toBe(ownerRecord.email)
  })

  // --- B. sessionVersion = 1 (password branch shape): token carries version 1 and verifies ---

  it('carries sessionVersion 1 in the token and verifies it (password-branch owner object)', async () => {
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    ownerRecord.sessionVersion = 1
    // Same shape findOwnerByEmailWithPassword returns: a Prisma Owner row.
    const passwordBranchOwner = { id: ownerRecord.id, email: ownerRecord.email, sessionVersion: 1, passwordHash: 'x', passwordSalt: 'y' }
    const token = await createOwnerSessionToken(passwordBranchOwner)

    const [encodedPayload] = token.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(payload.sessionVersion).toBe(1)

    expect(await verifyOwnerSessionToken(token)).toBe(ownerRecord.email)
  })

  // --- C. sessionVersion > 1: same behavior holds ---

  it('carries an arbitrary sessionVersion > 1 in the token and verifies it', async () => {
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    ownerRecord.sessionVersion = 7
    const token = await createOwnerSessionToken({ id: ownerRecord.id, email: ownerRecord.email, sessionVersion: 7 })

    const [encodedPayload] = token.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(payload.sessionVersion).toBe(7)

    expect(await verifyOwnerSessionToken(token)).toBe(ownerRecord.email)
  })

  // --- D. management-token branch: resolveCanonicalOwner-shaped object also carries real sessionVersion ---

  it('carries the real sessionVersion when given a resolveCanonicalOwner-shaped object', async () => {
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    ownerRecord.sessionVersion = 2
    // resolveCanonicalOwner returns a full Prisma Owner row (plus a _count field
    // when disambiguating duplicates) — not just { email, sessionVersion }.
    const canonicalOwner = {
      id: ownerRecord.id,
      email: ownerRecord.email,
      sessionVersion: 2,
      plan: 'free',
      createdAt: new Date(),
    }
    const token = await createOwnerSessionToken(canonicalOwner)

    const [encodedPayload] = token.split('.')
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    expect(payload.sessionVersion).toBe(2)

    expect(await verifyOwnerSessionToken(token)).toBe(ownerRecord.email)
  })

  // --- E. after a DB sessionVersion increment, the previously issued token is rejected ---

  it('rejects a previously issued token after the DB sessionVersion increments', async () => {
    const { createOwnerSessionToken, verifyOwnerSessionToken } = await import('@/lib/server/owner-auth')

    ownerRecord.sessionVersion = 1
    const tokenBeforeReset = await createOwnerSessionToken({ id: ownerRecord.id, email: ownerRecord.email, sessionVersion: 1 })
    expect(await verifyOwnerSessionToken(tokenBeforeReset)).toBe(ownerRecord.email)

    // Simulate resetOwnerPassword/setupOwnerPassword incrementing sessionVersion.
    ownerRecord.sessionVersion = 2

    expect(await verifyOwnerSessionToken(tokenBeforeReset)).toBe(null)
  })
})
