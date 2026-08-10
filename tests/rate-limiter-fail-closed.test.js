import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for FASE 2 of the rate-limit finding: the 8
// AUTH_CRITICAL endpoints now fail closed (503) when checkRateLimit()
// reports backendError, short-circuiting immediately after the FIRST
// bucket check that fails — no second Redis round-trip is attempted, and
// the 429 path stays completely unchanged for the healthy/limited cases.
// ABUSE_SENSITIVE endpoints already on checkRateLimit() must keep their
// existing fail-open behavior untouched.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
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

async function installRedis({ evalImpl, ttlImpl }) {
  const { Redis } = await import('@upstash/redis')
  Redis.mockImplementation(function () {
    return { eval: evalImpl, ttl: ttlImpl }
  })
}

async function setupCommonMocks() {
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: { findUnique: vi.fn().mockResolvedValue(null) },
    ownerPasswordResetToken: { findFirst: vi.fn().mockResolvedValue(null) },
  })
  const { findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
  findOwnerByEmailWithPassword.mockResolvedValue(null)
  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  getGalleryRepository.mockResolvedValue({
    getEventBySlug: vi.fn().mockResolvedValue(null),
  })
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
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})

afterEach(() => {
  restoreEnv()
})

function assertBackendErrorResponse(response, body) {
  expect(response.status).toBe(503)
  expect(body.code).toBe('rate_limit_backend_unavailable')
  expect(body.error).toBe('Authentication temporarily unavailable. Please try again shortly.')
  expect(response.headers.get('Retry-After')).toBe('30')
  // No infrastructure detail must ever reach the client.
  const serialized = JSON.stringify(body).toLowerCase()
  expect(serialized).not.toContain('redis')
  expect(serialized).not.toContain('upstash')
  expect(serialized).not.toContain('econnreset')
  expect(serialized).not.toContain('etimedout')
}

// ─── 20. admin/login: Redis error on its only bucket → 503 ──

describe('20 — POST /admin/login under Redis error', () => {
  it('responds 503 with the exact backend-error payload and no CORS-adjacent backend detail', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const ttlMock = vi.fn()
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { password: 'wrong-password' } }),
      { params: { path: ['admin', 'login'] } },
    )
    const body = await response.json()

    assertBackendErrorResponse(response, body)
    // Only one bucket exists for this endpoint; exactly one Redis attempt is made.
    expect(evalMock).toHaveBeenCalledTimes(1)
  })
})

// ─── 21. owner/login: Redis error on IP check → 503, email bucket never queried ──

describe('21 — POST /owner/login: Redis error on the IP bucket short-circuits before the email bucket', () => {
  it('responds 503 and calls Redis exactly once (login:ip only, never login:email)', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const ttlMock = vi.fn()
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'whatever' } }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    assertBackendErrorResponse(response, body)
    expect(evalMock).toHaveBeenCalledTimes(1)
    expect(evalMock.mock.calls[0][1][0]).toMatch(/^login:ip:/)
  })
})

// ─── 22. owner/login: IP check succeeds, email check fails → 503 ──

describe('22 — POST /owner/login: IP bucket healthy, email bucket errors', () => {
  it('calls both buckets in order and still fails closed on the second one', async () => {
    const evalMock = vi.fn(async (_script, keys) => {
      if (keys[0].startsWith('login:ip:')) return 1 // healthy
      throw new Error('ECONNRESET') // email bucket fails
    })
    const ttlMock = vi.fn()
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { email: OWNER_EMAIL, password: 'whatever' } }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    assertBackendErrorResponse(response, body)
    expect(evalMock).toHaveBeenCalledTimes(2)
    expect(evalMock.mock.calls[0][1][0]).toMatch(/^login:ip:/)
    expect(evalMock.mock.calls[1][1][0]).toMatch(/^login:email:/)
  })
})

// ─── 23. reset-password: IP check fails → token bucket never queried ──

describe('23 — POST /owner/reset-password: Redis error on the IP bucket short-circuits before the token bucket', () => {
  it('responds 503 and calls Redis exactly once (reset:ip only, never reset:token)', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const ttlMock = vi.fn()
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: { token: 'some-reset-token', password: 'StrongPassw0rd!23' } }),
      { params: { path: ['owner', 'reset-password'] } },
    )
    const body = await response.json()

    assertBackendErrorResponse(response, body)
    expect(evalMock).toHaveBeenCalledTimes(1)
    expect(evalMock.mock.calls[0][1][0]).toMatch(/^reset:ip:/)
  })
})

// ─── 24. ABUSE_SENSITIVE endpoint already on checkRateLimit: stays fail-open ──

describe('24 — an ABUSE_SENSITIVE endpoint (createGalleryDownload) ignores backendError and stays fail-open', () => {
  it('does not return 503 under the same Redis failure that fails admin/login closed', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const ttlMock = vi.fn()
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ body: {} }),
      { params: { path: ['events', 'some-slug', 'gallery-download'] } },
    )

    // Falls through to the (mocked) "event not found" path rather than
    // being blocked by the rate limiter — proves fail-open was preserved.
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
    expect(evalMock).toHaveBeenCalled()
  })
})

// ─── 25. Redis healthy + quota exceeded: 429 unchanged, dynamic Retry-After ──

describe('25 — Redis healthy and over quota: 429 unchanged with dynamic Retry-After', () => {
  it('admin/login returns 429 with retryAfter taken from Redis ttl(), not the fixed 503 value', async () => {
    const counts = new Map()
    const evalMock = vi.fn(async (_script, keys) => {
      const key = keys[0]
      const next = (counts.get(key) || 0) + 1
      counts.set(key, next)
      return next
    })
    const ttlMock = vi.fn().mockResolvedValue(777)
    await installRedis({ evalImpl: evalMock, ttlImpl: ttlMock })
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')

    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ body: { password: 'wrong-password' } }), { params: { path: ['admin', 'login'] } })
    }
    const blocked = await POST(makeRequest({ body: { password: 'wrong-password' } }), { params: { path: ['admin', 'login'] } })
    const body = await blocked.json()

    expect(blocked.status).toBe(429)
    expect(body.code).toBe('rate_limited')
    expect(body.retryAfter).toBe(777)
    expect(blocked.headers.get('Retry-After')).toBe('777')
  })
})

// ─── 26. Redis not configured: existing memory behavior unchanged ──

describe('26 — Redis not configured: admin/login keeps existing in-memory behavior, no 503', () => {
  it('allows 5 attempts, blocks the 6th with 429 (not 503)', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    await setupCommonMocks()

    const { POST } = await import('@/app/api/[[...path]]/route')

    for (let i = 0; i < 5; i++) {
      const response = await POST(makeRequest({ body: { password: 'wrong-password' } }), { params: { path: ['admin', 'login'] } })
      expect(response.status).not.toBe(429)
      expect(response.status).not.toBe(503)
    }
    const blocked = await POST(makeRequest({ body: { password: 'wrong-password' } }), { params: { path: ['admin', 'login'] } })
    expect(blocked.status).toBe(429)
  })
})
