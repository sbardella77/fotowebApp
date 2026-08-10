import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for FASE 1 of the rate-limit finding: the 8
// AUTH_CRITICAL endpoints (admin setup/login, owner session/login/resend/
// forgot-password/reset-password/setup) used to call the deprecated,
// always-in-memory rateLimit() — meaning Redis/Upstash was never consulted
// for these endpoints regardless of configuration. They now call the async,
// Redis-aware checkRateLimit(), with the EXACT same keys/limits/windows/
// order/status codes/messages as before. checkRateLimit()'s own fail-open
// behavior on Redis runtime errors is intentionally unchanged in this phase.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1'
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

// A minimal fake Redis that mimics the INCR+EXPIRE script's observable
// behavior: each call to a given key increments a counter; ttl() returns a
// fixed value so retryAfter is deterministic and inspectable.
function installHealthyRedisMock({ ttlSeconds = 900 } = {}) {
  const counts = new Map()
  const evalMock = vi.fn(async (_script, keys) => {
    const key = keys[0]
    const next = (counts.get(key) || 0) + 1
    counts.set(key, next)
    return next
  })
  const ttlMock = vi.fn(async () => ttlSeconds)
  return { evalMock, ttlMock, counts }
}

async function setupCommonMocks() {
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: { findUnique: vi.fn().mockResolvedValue(null) },
    ownerPasswordResetToken: { findFirst: vi.fn().mockResolvedValue(null) },
  })
  const { findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
  findOwnerByEmailWithPassword.mockResolvedValue(null)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-'.repeat(3)
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

afterEach(() => {
  restoreEnv()
})

// ─── A/C. Redis not configured: admin/login keeps the exact 5/15m in-memory limit ──

describe('A/C — Redis not configured: admin/login preserves the 5/15m IP limit via in-memory fallback', () => {
  it('allows 5 attempts then blocks the 6th with 429 + Retry-After, using in-memory (no Redis client constructed)', async () => {
    await setupCommonMocks()
    const { Redis } = await import('@upstash/redis')
    const { POST } = await import('@/app/api/[[...path]]/route')

    for (let i = 0; i < 5; i++) {
      const response = await POST(
        makeRequest({ body: { password: 'wrong-password' } }),
        { params: { path: ['admin', 'login'] } },
      )
      expect(response.status).not.toBe(429)
    }

    const blocked = await POST(
      makeRequest({ body: { password: 'wrong-password' } }),
      { params: { path: ['admin', 'login'] } },
    )
    const body = await blocked.json()

    expect(blocked.status).toBe(429)
    expect(body.code).toBe('rate_limited')
    expect(typeof body.retryAfter).toBe('number')
    expect(blocked.headers.get('Retry-After')).toBe(String(body.retryAfter))
    // Redis was never configured, so the client must never be constructed.
    expect(Redis).not.toHaveBeenCalled()
  })
})

// ─── B. Redis configured and healthy: auth endpoints go through checkRateLimit/Redis ──

describe('B — Redis configured and healthy: admin/login uses checkRateLimit/Redis', () => {
  it('calls Redis eval() with the unchanged bucket key and honors its count', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

    const { evalMock, ttlMock } = installHealthyRedisMock({ ttlSeconds: 900 })
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { password: 'wrong-password' } }),
      { params: { path: ['admin', 'login'] } },
    )

    expect(response.status).not.toBe(429)
    expect(evalMock).toHaveBeenCalledTimes(1)
    // Same key format as before the migration (admin-login:ip:<ip>).
    expect(evalMock.mock.calls[0][1][0]).toMatch(/^admin-login:ip:/)
  })

  it('blocks the 6th admin/login attempt via Redis-reported count, with retryAfter from Redis ttl()', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

    const { evalMock, ttlMock } = installHealthyRedisMock({ ttlSeconds: 42 })
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ body: { password: 'wrong-password' } }), { params: { path: ['admin', 'login'] } })
    }

    const blocked = await POST(
      makeRequest({ body: { password: 'wrong-password' } }),
      { params: { path: ['admin', 'login'] } },
    )
    const body = await blocked.json()

    expect(blocked.status).toBe(429)
    expect(body.retryAfter).toBe(42)
    expect(blocked.headers.get('Retry-After')).toBe('42')
    expect(ttlMock).toHaveBeenCalled()
  })
})

// ─── D. Owner login: both IP and email keys are still applied ──

describe('D — POST /owner/login applies both IP and email limits (Redis-backed)', () => {
  it('sends two distinct Redis keys — login:ip:* and login:email:* — for a single request', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'whatever' } }),
      { params: { path: ['owner', 'login'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('login:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `login:email:${OWNER_EMAIL}`)).toBe(true)
  })

  it('blocks on the email limit alone (5 attempts) even though the IP key stays under its own limit', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

    // IP count grows very slowly (return 1 every time) so only the email
    // bucket can trigger the block — proves the email key is independently enforced.
    const emailCounts = new Map()
    const evalMock = vi.fn(async (_script, keys) => {
      const key = keys[0]
      if (key.startsWith('login:ip:')) return 1
      const next = (emailCounts.get(key) || 0) + 1
      emailCounts.set(key, next)
      return next
    })
    const ttlMock = vi.fn(async () => 900)
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ body: { email: OWNER_EMAIL, password: 'x' } }), { params: { path: ['owner', 'login'] } })
    }
    const blocked = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'x' } }),
      { params: { path: ['owner', 'login'] } },
    )

    expect(blocked.status).toBe(429)
  })
})

// ─── E. Forgot-password / resend: IP + email unchanged ──

describe('E — forgot-password and resend keep IP + email keys', () => {
  it('POST /owner/forgot-password sends forgot:ip:* and forgot:email:* to Redis', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    await POST(
      makeRequest({ body: { email: OWNER_EMAIL } }),
      { params: { path: ['owner', 'forgot-password'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('forgot:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `forgot:email:${OWNER_EMAIL}`)).toBe(true)
  })

  it('POST /owner/resend sends resend:ip:* and resend:email:* to Redis', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    // resendOwnerAccess returns 503 before reaching the rate limit when the
    // Resend client isn't configured — set RESEND_API_KEY so the request
    // actually reaches the (unchanged) rate-limit check order.
    process.env.RESEND_API_KEY = 'test-resend-key'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    await POST(
      makeRequest({ body: { email: OWNER_EMAIL } }),
      { params: { path: ['owner', 'resend'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('resend:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `resend:email:${OWNER_EMAIL}`)).toBe(true)
  })
})

// ─── F. Reset/setup password: IP + token hash unchanged ──

describe('F — POST /owner/reset-password keeps IP + hashed-token keys', () => {
  it('sends reset:ip:* and reset:token:<sha256> to Redis, and passes through when under the limit', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { hashPasswordResetToken } = await import('@/lib/server/owner-auth')
    const { POST } = await import('@/app/api/[[...path]]/route')

    const rawToken = 'some-reset-token-value'
    const response = await POST(
      makeRequest({ body: { token: rawToken, password: 'StrongPassw0rd!23' } }),
      { params: { path: ['owner', 'reset-password'] } },
    )

    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('reset:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `reset:token:${hashPasswordResetToken(rawToken)}`)).toBe(true)
  })

  it('POST /owner/setup keeps setup:ip:* and setup:token:<sha256> keys', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { hashPasswordResetToken } = await import('@/lib/server/owner-auth')
    const { POST } = await import('@/app/api/[[...path]]/route')

    const rawToken = 'some-setup-token-value'
    await POST(
      makeRequest({ body: { token: rawToken, password: 'StrongPassw0rd!23' } }),
      { params: { path: ['owner', 'setup'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('setup:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `setup:token:${hashPasswordResetToken(rawToken)}`)).toBe(true)
  })
})

// ─── G / behavioral — POST /owner/session (loginOwner) and POST /admin/setup migrated too ──

describe('G — remaining migrated endpoints: owner/session and admin/setup', () => {
  it('POST /owner/session sends session:ip:* and session:email:* to Redis', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'whatever' } }),
      { params: { path: ['owner', 'session'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('session:ip:'))).toBe(true)
    expect(keysUsed.some((k) => k === `session:email:${OWNER_EMAIL}`)).toBe(true)
  })

  it('POST /admin/setup sends admin-setup:ip:* to Redis', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    const { evalMock, ttlMock } = installHealthyRedisMock()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    // With the 'env' admin driver (ADMIN_PASSWORD set), setupLocalAdminPassword
    // always rejects by design ("Admin password is controlled by environment
    // configuration") — pre-existing behavior unrelated to this migration.
    // The rate-limit check runs before that rejection, which is all this test verifies.
    await POST(
      makeRequest({ body: { password: 'StrongPassw0rd!23' } }),
      { params: { path: ['admin', 'setup'] } },
    ).catch(() => {})

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('admin-setup:ip:'))).toBe(true)
  })
})

// ─── Confirms checkRateLimit()'s own fail-open behavior on Redis runtime error is untouched ──

describe('Redis configured but erroring at runtime — fail-open to in-memory (unchanged in this phase)', () => {
  it('admin/login still succeeds (not blocked) when Redis eval() throws, falling back to in-memory', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const ttlMock = vi.fn()
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () { return { eval: evalMock, ttl: ttlMock } })

    await setupCommonMocks()
    const { POST } = await import('@/app/api/[[...path]]/route')

    const response = await POST(
      makeRequest({ body: { password: 'wrong-password' } }),
      { params: { path: ['admin', 'login'] } },
    )

    // Redis was attempted (eval called) but its failure degrades to
    // in-memory rather than blocking the request — this is the existing
    // checkRateLimit() fail-open behavior, intentionally NOT changed here.
    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(429)
  })
})
