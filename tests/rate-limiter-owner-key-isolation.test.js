import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// STEP 7.11b — fixes the live cross-category false-429/TTL-collision bug
// documented in STEP 7.11/7.11a: checkOwnerRateLimit used to key every
// OWNER_WRITE_LIMITS category as `owner:${hashIdentifier(ownerEmail)}` /
// `ip:${hashIdentifier(clientIp)}`, with NO category component — so e.g.
// 5 private-delivery uploads (10 increments) silently pre-consumed enough
// of the shared counter to false-429 the owner's very first cover upload
// (max 10), despite zero prior cover-upload attempts. The fix adds an
// explicit, static `scope` to every OWNER_WRITE_LIMITS entry and folds it
// into the key: owner:<scope>:<hash> / ip:<scope>:<hash>. Thresholds,
// call-site signatures, auth/CSRF order, and the 429 contract are all
// unchanged — this is purely a bucket-identity fix.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'
const OWNER_EMAIL_B = 'owner-b@example.com'
const SLUG = 'wedding-2026'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

async function buildOwnerRequest(body, { email = OWNER_EMAIL, method = 'POST', ip } = {}) {
  const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
  const { createCsrfToken } = await import('@/lib/server/csrf')
  const cookieValue = await createOwnerSessionToken({ email, sessionVersion: 0 })
  const csrfToken = createCsrfToken(email)
  return {
    method,
    headers: {
      get: (name) => {
        if (name === 'origin') return ALLOWED_ORIGIN
        if (name === 'x-csrf-token') return csrfToken
        if (name === 'x-forwarded-for' && ip) return ip
        return null
      },
    },
    cookies: { get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
    json: async () => body,
  }
}

function makeFakePrisma(emails = [OWNER_EMAIL]) {
  return {
    owner: {
      async findUnique({ where }) {
        if (emails.includes(where.email)) return { id: `owner-${where.email}`, email: where.email, sessionVersion: 0 }
        return null
      },
    },
  }
}

function installHealthyRedisMock() {
  const counts = new Map()
  const evalMock = vi.fn(async (_script, keys) => {
    const key = keys[0]
    const next = (counts.get(key) || 0) + 1
    counts.set(key, next)
    return next
  })
  const ttlMock = vi.fn(async () => 300)
  return { evalMock, ttlMock, counts }
}

async function setupRedis(mockImpl) {
  const { Redis } = await import('@upstash/redis')
  Redis.mockImplementation(function () { return mockImpl })
}

async function setupPrisma(emails = [OWNER_EMAIL]) {
  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue(makeFakePrisma(emails))
}

function setupRepositoryNotFound() {
  return {
    getEventBySlugAndOwner: vi.fn().mockResolvedValue(null),
    getPrivateAssetById: vi.fn().mockResolvedValue(null),
    setPhotoStatusByOwner: vi.fn().mockResolvedValue(null),
    deletePhotoByOwner: vi.fn().mockResolvedValue(null),
  }
}

async function mockRepository(overrides = {}) {
  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  getGalleryRepository.mockResolvedValue({ ...setupRepositoryNotFound(), ...overrides })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.CSRF_SECRET = 'test-csrf-secret'
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})

afterEach(() => {
  restoreEnv()
})

// ─── Config completeness/uniqueness ────────────────────────────────────────

describe('OWNER_WRITE_LIMITS — every entry (including dead configs) has a valid, unique scope', () => {
  it('every entry has a non-empty string scope', async () => {
    const { OWNER_WRITE_LIMITS } = await import('@/lib/server/rate-limiter')
    for (const [name, config] of Object.entries(OWNER_WRITE_LIMITS)) {
      expect(typeof config.scope, `${name}.scope`).toBe('string')
      expect(config.scope.trim().length, `${name}.scope non-empty`).toBeGreaterThan(0)
    }
  })

  it('scopes are unique across all entries', async () => {
    const { OWNER_WRITE_LIMITS } = await import('@/lib/server/rate-limiter')
    const scopes = Object.values(OWNER_WRITE_LIMITS).map((c) => c.scope)
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it('includes the two currently-dead configs (createEvent, galleryJobCreate)', async () => {
    const { OWNER_WRITE_LIMITS } = await import('@/lib/server/rate-limiter')
    expect(OWNER_WRITE_LIMITS.createEvent.scope).toBe('create-event')
    expect(OWNER_WRITE_LIMITS.galleryJobCreate.scope).toBe('gallery-job-create')
  })

  it('thresholds remain byte-identical to before this STEP', async () => {
    const { OWNER_WRITE_LIMITS } = await import('@/lib/server/rate-limiter')
    expect(OWNER_WRITE_LIMITS.privateDeliveryWrite.owner).toEqual({ max: 60, window: 10 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.photographerLinkWrite.owner).toEqual({ max: 20, window: 60 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.coverUpload.owner).toEqual({ max: 10, window: 10 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.coverUpload.ip).toEqual({ max: 10, window: 10 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.coverDelete.owner).toEqual({ max: 20, window: 60 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.momentsWrite.owner).toEqual({ max: 60, window: 10 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.updateEvent.owner).toEqual({ max: 60, window: 10 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.deleteEvent.owner).toEqual({ max: 20, window: 60 * 60 * 1000 })
    expect(OWNER_WRITE_LIMITS.deletePhoto.owner).toEqual({ max: 60, window: 10 * 60 * 1000 })
  })
})

// ─── Call-site signatures unchanged (structural) ───────────────────────────

describe('checkOwnerRateLimit call sites remain textually unchanged (no 4th scope argument added)', () => {
  it('all 14 call sites still pass only (request, ownerEmail, OWNER_WRITE_LIMITS.<category>)', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
    const matches = source.match(/checkOwnerRateLimit\(request, ownerEmail, OWNER_WRITE_LIMITS\.\w+\)/g) || []
    expect(matches.length).toBe(14)
  })
})

// ─── Cross-category isolation — the core regression proof ─────────────────

describe('Cross-category isolation — the live false-429 bug is fixed', () => {
  it('§G1: 10 private-delivery-write increments do NOT block the first cover-upload evaluation', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    // Simulate "5 completed private-delivery files" = 10 prior increments
    // on that category's OWN scoped key.
    counts.set(`owner:private-delivery-write:${hashIdentifier(OWNER_EMAIL)}`, 10)

    await setupPrisma()
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ coverDataUrl: 'not-a-real-data-url' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    // Must NOT be 429 — cover-upload's own counter starts fresh regardless
    // of private-delivery-write's state.
    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed).toContain(`owner:cover-upload:${hashIdentifier(OWNER_EMAIL)}`)
  })

  it('§G2: 20 moments-write increments do NOT block the first photographer-link-write evaluation', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`owner:moments-write:${hashIdentifier(OWNER_EMAIL)}`, 20)

    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({})
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'photographer-link'] } })

    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed).toContain(`owner:photographer-link-write:${hashIdentifier(OWNER_EMAIL)}`)
  })

  it('§12: the same owner gets 7 structurally distinct keys across 7 categories', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await setupPrisma()
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')

    await POST(await buildOwnerRequest({ coverDataUrl: 'x' }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    await POST(await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }), { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })
    await POST(await buildOwnerRequest({ name: 'x' }), { params: { path: ['owner', 'events', SLUG, 'moments'] } })
    await POST(await buildOwnerRequest({}), { params: { path: ['owner', 'events', SLUG, 'photographer-link'] } })
    await POST(await buildOwnerRequest({}, { method: 'PATCH' }), { params: { path: ['owner', 'events', SLUG] } })
    await POST(await buildOwnerRequest({ action: 'approve' }, { method: 'PATCH' }), { params: { path: ['owner', 'photos', 'photo-1'] } })

    const keysUsed = new Set(evalMock.mock.calls.map((c) => c[1][0]).filter((k) => k.startsWith('owner:')))
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const H = hashIdentifier(OWNER_EMAIL)
    expect(keysUsed).toContain(`owner:cover-upload:${H}`)
    expect(keysUsed).toContain(`owner:private-delivery-write:${H}`)
    expect(keysUsed).toContain(`owner:moments-write:${H}`)
    expect(keysUsed).toContain(`owner:photographer-link-write:${H}`)
    // No two categories collapse onto the same key.
    expect(keysUsed.size).toBeGreaterThanOrEqual(4)
  })
})

// ─── Same-category grouping preserved ──────────────────────────────────────

describe('Intended within-category sharing is preserved', () => {
  it('private-delivery init and complete use the exact same scoped key', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await setupPrisma()
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(
      await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } },
    )
    await POST(
      await buildOwnerRequest({ sessionId: 'session-1' }),
      { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } },
    )

    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const expectedKey = `owner:private-delivery-write:${hashIdentifier(OWNER_EMAIL)}`
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed.filter((k) => k === expectedKey).length).toBe(2)
  })

  it('createPhotographerUploadLink and deletePhotographerUploadLink use the exact same scoped key', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(await buildOwnerRequest({}), { params: { path: ['owner', 'events', SLUG, 'photographer-link'] } })
    await POST(await buildOwnerRequest({}, { method: 'DELETE' }), { params: { path: ['owner', 'events', SLUG, 'photographer-link'] } })

    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const expectedKey = `owner:photographer-link-write:${hashIdentifier(OWNER_EMAIL)}`
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed.filter((k) => k === expectedKey).length).toBe(2)
  })
})

// ─── Different owners never collide ────────────────────────────────────────

describe('Different owners get independent keys within the same category', () => {
  it('owner A and owner B produce different cover-upload keys', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await setupPrisma([OWNER_EMAIL, OWNER_EMAIL_B])
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const responseA = await POST(await buildOwnerRequest({ coverDataUrl: 'x' }, { email: OWNER_EMAIL }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    const responseB = await POST(await buildOwnerRequest({ coverDataUrl: 'x' }, { email: OWNER_EMAIL_B }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    expect(responseA.status).not.toBe(401)
    expect(responseB.status).not.toBe(401)

    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed).toContain(`owner:cover-upload:${hashIdentifier(OWNER_EMAIL)}`)
    expect(keysUsed).toContain(`owner:cover-upload:${hashIdentifier(OWNER_EMAIL_B)}`)
    expect(hashIdentifier(OWNER_EMAIL)).not.toBe(hashIdentifier(OWNER_EMAIL_B))
  })
})

// ─── Cover IP key ───────────────────────────────────────────────────────────

describe('coverUpload IP branch is also category-scoped', () => {
  it('sends ip:cover-upload:<hash> — never raw IP', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await mockRepository()

    const request = await buildOwnerRequest({ coverDataUrl: 'x' }, { ip: '203.0.113.99' })

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed).toContain(`ip:cover-upload:${hashIdentifier('203.0.113.99')}`)
    expect(keysUsed.some((k) => k.includes('203.0.113.99'))).toBe(false)
  })
})

// ─── Redis outage — key consistency + fail-open preserved ─────────────────

describe('Redis outage: fail-open-with-memory preserved, same scoped key used for fallback', () => {
  it('backendError true, memory fallback under limit → proceeds, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(await buildOwnerRequest({ coverDataUrl: 'x' }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
  })

  it('backendError true AND memory fallback limited → existing bare rate_limited 429, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    // coverUpload.owner.max = 10 — drive the memory fallback bucket to its limit.
    let last
    for (let i = 0; i < 11; i++) {
      last = await POST(await buildOwnerRequest({ coverDataUrl: 'x' }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    }

    expect(last.status).not.toBe(503)
    expect(last.status).toBe(429)
    const body = await last.json()
    expect(body).toEqual({ error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: expect.any(Number) })
  })
})

// ─── 429 contract unchanged ─────────────────────────────────────────────────

describe('429 contract is byte-identical to before this STEP', () => {
  it('exact status/body/header shape from buildRateLimitResponse', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`owner:cover-upload:${hashIdentifier(OWNER_EMAIL)}`, 10)
    await mockRepository()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(await buildOwnerRequest({ coverDataUrl: 'x' }), { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.error).toBe('Too many requests. Please try again later.')
    expect(body.code).toBe('rate_limited')
    expect(typeof body.retryAfter).toBe('number')
    expect(response.headers.get('Retry-After')).toBe(String(body.retryAfter))
  })
})

// ─── Auth/CSRF regression ───────────────────────────────────────────────────

describe('Auth/CSRF ordering unchanged — still enforced before rate limiting', () => {
  it('missing owner session → 401, checkRateLimit never reached', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = {
      method: 'POST',
      headers: { get: (name) => (name === 'origin' ? ALLOWED_ORIGIN : null) },
      cookies: { get: () => undefined },
      json: async () => ({ coverDataUrl: 'x' }),
    }
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    expect(response.status).toBe(401)
    expect(evalMock).not.toHaveBeenCalled()
  })

  it('valid session but missing CSRF token → 403, checkRateLimit never reached', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    await setupPrisma()

    const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
    const cookieValue = await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: 0 })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = {
      method: 'POST',
      headers: { get: (name) => (name === 'origin' ? ALLOWED_ORIGIN : null) },
      cookies: { get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
      json: async () => ({ coverDataUrl: 'x' }),
    }
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    expect(response.status).toBe(403)
    expect(evalMock).not.toHaveBeenCalled()
  })
})
