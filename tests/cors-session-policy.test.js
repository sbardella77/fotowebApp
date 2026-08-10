import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for the CORS Option 1 split: SESSION_ONLY (cookie-based
// admin/owner) endpoints in the catch-all route must never advertise
// Access-Control-* headers, while PUBLIC/token-based endpoints must keep
// their current CORS behavior unchanged. Every test below invokes the real
// exported GET/POST handlers from @/app/api/[[...path]]/route, not just
// grep/static assertions on the source.

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
  // All admin tests here use ADMIN_PASSWORD, which always selects the 'env' driver.
  getAdminAuthDriver: vi.fn().mockReturnValue('env'),
}))

vi.mock('@/lib/server/owner-resolution', () => ({
  resolveCanonicalOwner: vi.fn(),
  findOwnerByEmailWithPassword: vi.fn(),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const EVIL_ORIGIN = 'https://evil.example'
const ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_SESSION_VERSION = 0

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ method = 'GET', body, origin, cookie } = {}) {
  return {
    method,
    headers: {
      get: (name) => {
        if (name === 'origin') return origin ?? null
        return null
      },
    },
    cookies: {
      get: (name) => (cookie && cookie.name === name ? { value: cookie.value } : undefined),
    },
    json: async () => body ?? {},
  }
}

const CORS_HEADER_NAMES = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
]

function expectNoCorsHeaders(response) {
  for (const name of CORS_HEADER_NAMES) {
    expect(response.headers.get(name)).toBeNull()
  }
}

function expectPublicCorsHeaders(response) {
  expect(response.headers.get('access-control-allow-origin')).toBe(process.env.CORS_ORIGINS || '*')
  expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, PATCH, DELETE, OPTIONS')
  expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, Authorization')
}

async function buildAdminCookie() {
  const { createAdminSessionToken, ADMIN_COOKIE_NAME } = await import('@/lib/server/admin-auth')
  return { name: ADMIN_COOKIE_NAME, value: await createAdminSessionToken() }
}

async function buildOwnerCookie() {
  const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
  const token = await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: OWNER_SESSION_VERSION })
  return { name: OWNER_COOKIE_NAME, value: token }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-'.repeat(3)
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN

  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: {
      findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, sessionVersion: OWNER_SESSION_VERSION }),
    },
    event: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  })

  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  getGalleryRepository.mockResolvedValue({
    listEvents: vi.fn().mockResolvedValue([]),
    listEventsByOwnerEmail: vi.fn().mockResolvedValue([]),
    getEventBySlug: vi.fn().mockResolvedValue(null),
    getEventBySlugAndOwner: vi.fn().mockResolvedValue(null),
  })
})

afterEach(() => {
  restoreEnv()
})

// ─── A. SESSION_ONLY endpoints must never return Access-Control-* headers ──

describe('SESSION_ONLY endpoints — no Access-Control-* headers', () => {
  const cases = [
    {
      name: 'GET /api/admin/config',
      path: ['admin', 'config'],
      build: () => makeRequest({ method: 'GET' }),
    },
    {
      name: 'GET /api/admin/session',
      path: ['admin', 'session'],
      build: () => makeRequest({ method: 'GET' }),
    },
    {
      name: 'POST /api/admin/login (valid credentials)',
      path: ['admin', 'login'],
      build: () => makeRequest({ method: 'POST', origin: ALLOWED_ORIGIN, body: { password: ADMIN_PASSWORD } }),
    },
    {
      name: 'GET /api/owner/session',
      path: ['owner', 'session'],
      build: () => makeRequest({ method: 'GET' }),
    },
    {
      name: 'POST /api/owner/login (valid credentials)',
      path: ['owner', 'login'],
      build: async () => {
        const { findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution')
        findOwnerByEmailWithPassword.mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, sessionVersion: OWNER_SESSION_VERSION, passwordHash: 'x', passwordSalt: 'y' })
        return makeRequest({ method: 'POST', origin: ALLOWED_ORIGIN, body: { email: OWNER_EMAIL, password: 'whatever' } })
      },
    },
    {
      name: 'GET /api/owner/events (authenticated owner read)',
      path: ['owner', 'events'],
      build: async () => makeRequest({ method: 'GET', cookie: await buildOwnerCookie() }),
    },
    {
      name: 'PATCH /api/owner/events/:slug (protected owner mutation, no CSRF token)',
      path: ['owner', 'events', 'some-slug'],
      build: async () => makeRequest({ method: 'PATCH', origin: ALLOWED_ORIGIN, cookie: await buildOwnerCookie(), body: { name: 'New name' } }),
    },
    {
      name: 'GET /api/admin/events (authenticated admin, delegates to shared PUBLIC listEvents())',
      path: ['admin', 'events'],
      build: async () => makeRequest({ method: 'GET', cookie: await buildAdminCookie() }),
    },
  ]

  for (const { name, path, build } of cases) {
    it(`${name} has no Access-Control-* headers`, async () => {
      const { GET, POST, PATCH } = await import('@/app/api/[[...path]]/route')
      const request = await build()
      const dispatch = { GET, POST, PATCH }[request.method]
      const response = await dispatch(request, { params: { path } })
      expectNoCorsHeaders(response)
    })
  }
})

// ─── B. PUBLIC/token-based endpoints must keep their current CORS behavior ──

describe('PUBLIC endpoints — unchanged Access-Control-* headers', () => {
  it('GET /api/events keeps public CORS headers', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(makeRequest({ method: 'GET' }), { params: { path: ['events'] } })
    expectPublicCorsHeaders(response)
  })

  it('GET /api/events/:slug keeps public CORS headers (even on 404)', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(makeRequest({ method: 'GET' }), { params: { path: ['events', 'unknown-slug'] } })
    expect(response.status).toBe(404)
    expectPublicCorsHeaders(response)
  })

  it('POST /api/uploads/init keeps public CORS headers (even on 404)', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ method: 'POST', body: { eventSlug: 'unknown-slug', fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 } }),
      { params: { path: ['uploads', 'init'] } },
    )
    expect(response.status).toBe(404)
    expectPublicCorsHeaders(response)
  })

  it('GET /api/photographer-upload/:token keeps public CORS headers (even on invalid token)', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(makeRequest({ method: 'GET' }), { params: { path: ['photographer-upload', 'invalid-token'] } })
    expect(response.status).toBe(403)
    expectPublicCorsHeaders(response)
  })
})

// ─── C. SESSION_ONLY endpoint rejected due to a malicious Origin: still no CORS headers ──

describe('SESSION_ONLY endpoint with a malicious Origin', () => {
  it('POST /api/owner/login rejects Origin: https://evil.example without leaking CORS headers', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ method: 'POST', origin: EVIL_ORIGIN, body: { email: OWNER_EMAIL, password: 'whatever' } }),
      { params: { path: ['owner', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
    expectNoCorsHeaders(response)
  })

  it('POST /api/admin/login rejects Origin: https://evil.example without leaking CORS headers', async () => {
    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ method: 'POST', origin: EVIL_ORIGIN, body: { password: ADMIN_PASSWORD } }),
      { params: { path: ['admin', 'login'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('origin_not_allowed')
    expectNoCorsHeaders(response)
  })
})

// ─── D. SESSION_ONLY error responses (401/403/404/503) never leak CORS headers ──

describe('SESSION_ONLY error responses — status code diversity', () => {
  it('401 — GET /api/owner/events without a session cookie', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(makeRequest({ method: 'GET' }), { params: { path: ['owner', 'events'] } })
    expect(response.status).toBe(401)
    expectNoCorsHeaders(response)
  })

  it('403 — PATCH /api/owner/events/:slug with a valid session but no CSRF token', async () => {
    const { PATCH } = await import('@/app/api/[[...path]]/route')
    const response = await PATCH(
      makeRequest({ method: 'PATCH', origin: ALLOWED_ORIGIN, cookie: await buildOwnerCookie(), body: { name: 'New name' } }),
      { params: { path: ['owner', 'events', 'some-slug'] } },
    )
    expect(response.status).toBe(403)
    expectNoCorsHeaders(response)
  })

  it('404 — GET /api/owner/events/:slug for a room the owner does not have', async () => {
    const { GET } = await import('@/app/api/[[...path]]/route')
    const response = await GET(
      makeRequest({ method: 'GET', cookie: await buildOwnerCookie() }),
      { params: { path: ['owner', 'events', 'some-slug'] } },
    )
    expect(response.status).toBe(404)
    expectNoCorsHeaders(response)
  })

  it('503 — POST /api/owner/reset-password when the database is unavailable', async () => {
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(null)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({
        method: 'POST',
        origin: ALLOWED_ORIGIN,
        body: { token: 'some-reset-token', password: 'StrongPassw0rd!23' },
      }),
      { params: { path: ['owner', 'reset-password'] } },
    )
    expect(response.status).toBe(503)
    expectNoCorsHeaders(response)
  })
})
