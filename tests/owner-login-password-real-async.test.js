import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// End-to-end coverage for the scryptSync → promisify(scrypt) migration through
// the REAL owner login/reset/setup route handlers. Unlike the other route
// tests in this suite, '@/lib/server/owner-resolution' and
// '@/lib/server/owner-password' are deliberately left UNMOCKED here: the real
// findOwnerByEmailWithPassword + verifyPassword/createPasswordHash (and thus
// the real async scrypt) execute on every request, so a forgotten `await`
// anywhere on the password path would surface as a real login bypass or
// real login failure — not just a unit-level assertion.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ method = 'POST', body, origin = ALLOWED_ORIGIN } = {}) {
  return {
    method,
    headers: {
      get: (name) => (name === 'origin' ? origin : null),
    },
    cookies: { get: () => undefined },
    json: async () => body ?? {},
  }
}

let ownerRecord

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-'.repeat(3)
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN

  // Real hash produced by the (now async) production createPasswordHash, so
  // this fixture round-trips through the actual migrated implementation
  // rather than a hardcoded legacy value (that compatibility case is covered
  // separately in owner-password-async.test.js).
  const { createPasswordHash } = await import('@/lib/server/owner-password')
  const { salt, hash } = await createPasswordHash('CorrectHorseBatteryStaple1!')

  ownerRecord = {
    id: 'owner-1',
    email: OWNER_EMAIL,
    sessionVersion: 0,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date('2024-01-01'),
  }
})

afterEach(() => {
  restoreEnv()
})

async function installOwnerPrismaMock() {
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: {
      findMany: vi.fn(async ({ where }) => {
        const normalized = where?.email?.equals
        return normalized === OWNER_EMAIL ? [{ ...ownerRecord, _count: { events: 0 } }] : []
      }),
      findUnique: vi.fn(async ({ where }) => (where?.email === OWNER_EMAIL ? ownerRecord : null)),
    },
  })
}

describe('POST /api/owner/session — real async password verification', () => {
  it('accepts the correct password and issues a session', async () => {
    await installOwnerPrismaMock()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'CorrectHorseBatteryStaple1!' } }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(response.headers.get('set-cookie')).toMatch(/snaprooms_owner_session=/)
  })

  it('rejects a wrong password with 401', async () => {
    await installOwnerPrismaMock()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'TotallyWrongPassword!' } }),
      { params: { path: ['owner', 'session'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toMatch(/invalid/i)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/owner/login — real async password verification', () => {
  it('accepts the correct password and issues a session', async () => {
    await installOwnerPrismaMock()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'CorrectHorseBatteryStaple1!' } }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)
    expect(response.headers.get('set-cookie')).toMatch(/snaprooms_owner_session=/)
  })

  it('rejects a wrong password with 401', async () => {
    await installOwnerPrismaMock()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'TotallyWrongPassword!' } }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toMatch(/invalid/i)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/owner/reset-password — persists a real async hash, unchanged sessionVersion behavior', () => {
  it('hashes the new password with the async path, persists it, and it is verifiable by verifyPassword', async () => {
    const updateCalls = []
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue({
      ownerPasswordResetToken: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'token-1',
          ownerId: 'owner-1',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          owner: ownerRecord,
        }),
      },
      owner: {
        findUnique: vi.fn().mockResolvedValue({ ...ownerRecord, email: OWNER_EMAIL }),
      },
      $transaction: vi.fn(async (fn) => {
        const tx = {
          ownerPasswordResetToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'token-1',
              ownerId: 'owner-1',
              usedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
            }),
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({}),
          },
          owner: {
            update: vi.fn(async ({ data }) => {
              updateCalls.push(data)
              return { ...ownerRecord, ...data }
            }),
          },
        }
        return fn(tx)
      }),
    })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { token: 'some-raw-reset-token', password: 'BrandNewStrongPassw0rd!23' } }),
      { params: { path: ['owner', 'reset-password'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)

    // Exactly one owner.update call, carrying a freshly derived hash/salt pair
    // and the unchanged sessionVersion-increment behavior (untouched by this
    // finding — verified here only to prove no regression was introduced).
    expect(updateCalls).toHaveLength(1)
    const persisted = updateCalls[0]
    expect(persisted.sessionVersion).toEqual({ increment: 1 })
    expect(persisted.passwordHash).toMatch(/^[a-f0-9]{128}$/)
    expect(persisted.passwordSalt).toMatch(/^[a-f0-9]{32}$/)

    const { verifyPassword } = await import('@/lib/server/owner-password')
    expect(await verifyPassword('BrandNewStrongPassw0rd!23', persisted.passwordSalt, persisted.passwordHash)).toBe(true)
    expect(await verifyPassword('WrongPassword!', persisted.passwordSalt, persisted.passwordHash)).toBe(false)
  })
})

describe('POST /api/owner/setup-password — persists a real async hash', () => {
  it('hashes the initial password with the async path and persists it', async () => {
    const updateCalls = []
    const ownerWithoutPassword = { id: 'owner-2', email: OWNER_EMAIL, sessionVersion: 0, passwordHash: null, passwordSalt: null }

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue({
      ownerPasswordResetToken: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'token-2',
          ownerId: 'owner-2',
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          owner: ownerWithoutPassword,
        }),
      },
      owner: {
        findUnique: vi.fn().mockResolvedValue({ ...ownerWithoutPassword, email: OWNER_EMAIL }),
      },
      $transaction: vi.fn(async (fn) => {
        const tx = {
          ownerPasswordResetToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'token-2',
              ownerId: 'owner-2',
              usedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
            }),
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({}),
          },
          owner: {
            update: vi.fn(async ({ data }) => {
              updateCalls.push(data)
              return { ...ownerWithoutPassword, ...data }
            }),
          },
        }
        return fn(tx)
      }),
    })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { token: 'some-raw-setup-token', password: 'InitialStrongPassw0rd!23' } }),
      { params: { path: ['owner', 'setup'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.authenticated).toBe(true)

    expect(updateCalls).toHaveLength(1)
    const persisted = updateCalls[0]
    expect(persisted.passwordHash).toMatch(/^[a-f0-9]{128}$/)
    expect(persisted.passwordSalt).toMatch(/^[a-f0-9]{32}$/)

    const { verifyPassword } = await import('@/lib/server/owner-password')
    expect(await verifyPassword('InitialStrongPassw0rd!23', persisted.passwordSalt, persisted.passwordHash)).toBe(true)
  })
})
