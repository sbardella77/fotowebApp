import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hashPhotographerUploadToken, generatePhotographerUploadToken } from '@/lib/server/photographer-token'

// STEP 7.10a — migrates initPhotographerUpload/completePhotographerUpload
// from the legacy, always-in-memory, IP-scoped (and cross-flow-shared)
// rateLimit() to a Redis-aware checkRateLimit() keyed on
// hashPhotographerUploadToken(token) — stable per link, immune to shared
// venue WiFi/NAT, immune to the photographer switching networks. See
// STEP 7.10/7.10a.0 for the full identity/threshold derivation.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
}))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn().mockResolvedValue({}),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getStorageDriver: vi.fn().mockReturnValue({
      mode: 'vercel-blob',
      initUploadSession: async ({ sessionId, expectedPathname, handleUploadUrl }) => ({
        sessionId,
        pathname: expectedPathname,
        handleUploadUrl,
        uploadStrategy: 'vercel-blob-client',
      }),
    }),
  }
})

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const EVENT_ID = 'event-1'
const SLUG = 'wedding-2026'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const IP = '198.51.100.7'
const OTHER_IP = '198.51.100.8'

function makeRequest(body, { ip = IP } = {}) {
  return {
    method: 'POST',
    headers: {
      get: (name) => {
        if (name === 'origin') return ALLOWED_ORIGIN
        if (name === 'x-forwarded-for') return ip
        return null
      },
    },
    cookies: { get: () => undefined },
    json: async () => body,
  }
}

function makeFakePrisma({ tokenHash, billingTier = 'wedding_pro' } = {}) {
  const event = { id: EVENT_ID, slug: SLUG, name: 'Wedding', ownerEmail: 'owner@example.com', billingTier, photographerUploadTokenHash: tokenHash, photographerUploadTokenExpiresAt: null }
  return {
    event: {
      async findFirst({ where }) {
        return where.photographerUploadTokenHash === tokenHash ? { ...event } : null
      },
    },
    // initPhotographerUpload's vercel-blob branch creates a session;
    // completePhotographerUpload's looks one up via
    // completePrivateAssetBlobUpload (a not-found session cleanly
    // short-circuits to a 4xx BlobUploadCompletionError rather than
    // crashing) — both are all these rate-limit-focused tests need past
    // the limiter check itself.
    blobUploadSession: {
      create: async ({ data }) => ({ id: 'session-x', status: 'PENDING', ...data }),
      findUnique: async () => null,
    },
  }
}

// Like makeFakePrisma, but exposes a spy on event.findFirst — used by the
// broad-guard tests to prove getPhotographerEventFromToken's DB lookup
// never runs for a broad-blocked request.
function makeFakePrismaWithFindFirstSpy({ tokenHash, billingTier = 'wedding_pro' } = {}) {
  const event = { id: EVENT_ID, slug: SLUG, name: 'Wedding', ownerEmail: 'owner@example.com', billingTier, photographerUploadTokenHash: tokenHash, photographerUploadTokenExpiresAt: null }
  const eventFindFirst = vi.fn(async ({ where }) => (where.photographerUploadTokenHash === tokenHash ? { ...event } : null))
  const prisma = {
    event: { findFirst: eventFindFirst },
    blobUploadSession: {
      create: async ({ data }) => ({ id: 'session-x', status: 'PENDING', ...data }),
      findUnique: async () => null,
    },
  }
  return { prisma, eventFindFirst }
}

function installHealthyRedisMock({ ttlSeconds = 600 } = {}) {
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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})

afterEach(() => {
  restoreEnv()
})

async function setupRedis(mockImpl) {
  const { Redis } = await import('@upstash/redis')
  Redis.mockImplementation(function () { return mockImpl })
}

describe('initPhotographerUpload — token-hash Redis identity', () => {
  it('sends photographer-init:token:<sha256> to Redis, never the raw token', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    // The broad IP guard (STEP 7.10a.1) runs first, then the token-hash bucket.
    expect(keysUsed).toHaveLength(2)
    expect(keysUsed[0]).toMatch(/^photographer-init-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[1]).toBe(`photographer-init:token:${tokenHash}`)
    expect(keysUsed.join(',')).not.toContain(token)
  })

  it('blocks the 201st init attempt for the same token with the exact bare 429 contract', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock({ ttlSeconds: 55 })
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doInit = () =>
      POST(
        makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
        { params: { path: ['photographer-upload', token, 'init'] } },
      )

    for (let i = 0; i < 199; i++) {
      const r = await doInit()
      expect(r.status).not.toBe(429)
    }
    const allowed200th = await doInit()
    expect(allowed200th.status).not.toBe(429)

    const blocked = await doInit()
    const body = await blocked.json()
    expect(blocked.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(blocked.headers.get('Retry-After')).toBeNull()
    expect(body.code).toBeUndefined()
    expect(body.retryAfter).toBeUndefined()
  })

  it('two different photographer tokens on the same request context get distinct buckets', async () => {
    const tokenA = generatePhotographerUploadToken()
    const tokenB = generatePhotographerUploadToken()
    const hashA = hashPhotographerUploadToken(tokenA)
    const hashB = hashPhotographerUploadToken(tokenB)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue({
      event: {
        async findFirst({ where }) {
          if (where.photographerUploadTokenHash === hashA) return { id: 'event-a', slug: 'event-a', billingTier: 'wedding_pro' }
          if (where.photographerUploadTokenHash === hashB) return { id: 'event-b', slug: 'event-b', billingTier: 'wedding_pro' }
          return null
        },
      },
      blobUploadSession: {
        create: async ({ data }) => ({ id: 'session-x', status: 'PENDING', ...data }),
      },
    })

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeRequest({ eventSlug: 'event-a', fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }), { params: { path: ['photographer-upload', tokenA, 'init'] } })
    await POST(makeRequest({ eventSlug: 'event-b', fileName: 'b.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }), { params: { path: ['photographer-upload', tokenB, 'init'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`photographer-init:token:${hashA}`)
    expect(keysUsed).toContain(`photographer-init:token:${hashB}`)
    // 2 distinct token buckets + 1 shared broad-IP bucket (same IP for both calls).
    expect(new Set(keysUsed).size).toBe(3)
  })

  it('Redis outage: backendError true but memory fallback under limit → proceeds, never 503', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })
})

describe('completePhotographerUpload — token-hash Redis identity, separate category from init', () => {
  it('sends photographer-complete:token:<sha256> to Redis, distinct from the init category', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(
      makeRequest({ sessionId: 'session-1' }),
      { params: { path: ['photographer-upload', token, 'complete'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toHaveLength(2)
    expect(keysUsed[0]).toMatch(/^photographer-complete-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[1]).toBe(`photographer-complete:token:${tokenHash}`)
    expect(keysUsed.join(',')).not.toContain(token)
  })

  it('blocks the 201st complete attempt with the exact bare 429 contract (no code/retryAfter/header)', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock({ ttlSeconds: 30 })
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doComplete = () =>
      POST(makeRequest({ sessionId: 'session-1' }), { params: { path: ['photographer-upload', token, 'complete'] } })

    for (let i = 0; i < 200; i++) {
      await doComplete()
    }
    const blocked = await doComplete()
    const body = await blocked.json()

    expect(blocked.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
    expect(blocked.headers.get('Retry-After')).toBeNull()
  })

  it('Redis outage: backendError true AND memory fallback limited → existing bare 429, never 503', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doComplete = () =>
      POST(makeRequest({ sessionId: 'session-1' }), { params: { path: ['photographer-upload', token, 'complete'] } })

    // Drive the in-memory fallback bucket (shared module-level Map, not
    // reset by vi.resetModules() mid-describe-block since it's within the
    // same test's dynamic import) to its own limit.
    let last
    for (let i = 0; i < 201; i++) {
      last = await doComplete()
    }

    expect(last.status).not.toBe(503)
    expect(last.status).toBe(429)
    const body = await last.json()
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
  })
})

describe('Guest/Private-Delivery init/complete are untouched by this migration', () => {
  it('the guest upload-init:ip / upload-complete:ip legacy keys and RATE_LIMITS.uploadInit/uploadComplete values are unchanged', async () => {
    const { RATE_LIMITS } = await import('@/lib/server/rate-limiter')
    expect(RATE_LIMITS.uploadInit).toEqual({ ip: { max: 30, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.uploadComplete).toEqual({ ip: { max: 30, window: 10 * 60 * 1000 } })
  })

  it('new photographer/broad-guard categories exist without altering any pre-existing RATE_LIMITS key', async () => {
    const { RATE_LIMITS } = await import('@/lib/server/rate-limiter')
    expect(RATE_LIMITS.photographerInit).toEqual({ token: { max: 200, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.photographerComplete).toEqual({ token: { max: 200, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.photographerBlobEvent).toEqual({ event: { max: 200, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.uploadBlobBroad).toEqual({ ip: { max: 1000, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.photographerInitBroad).toEqual({ ip: { max: 1000, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.photographerCompleteBroad).toEqual({ ip: { max: 1000, window: 10 * 60 * 1000 } })
    // Untouched by this STEP:
    expect(RATE_LIMITS.uploadBlob).toEqual({ ip: { max: 30, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.uploadChunk).toEqual({ ip: { max: 200, window: 10 * 60 * 1000 } })
    expect(RATE_LIMITS.createEvent).toEqual({ ip: { max: 10, window: 60 * 60 * 1000 } })
    expect(RATE_LIMITS.sendEventEmail).toEqual({ ip: { max: 5, window: 60 * 60 * 1000 } })
    expect(RATE_LIMITS.coverUpload).toEqual({ ip: { max: 10, window: 10 * 60 * 1000 }, owner: { max: 10, window: 10 * 60 * 1000 } })
  })
})

// STEP 7.10a.1 — the raw photographer token is attacker-controlled until
// getPhotographerEventFromToken() validates it (a DB lookup). A broad,
// hashed-IP, Redis-backed pre-auth guard now runs BEFORE both the
// token-hash bucket and that lookup on each of init/complete, in its own
// per-stage 1000/IP category (never shared between the two stages, so a
// normal one-init-plus-one-complete upload never double-charges a single
// combined ceiling).

describe('initPhotographerUpload — broad pre-auth IP guard (photographer-init-broad)', () => {
  it('sends a hashed IP key, never the raw IP', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed[0]).toMatch(/^photographer-init-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
  })

  it('1000th request allowed; 1001st blocked with zero token-limiter call and zero DB lookup', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`photographer-init-broad:ip:${hashIdentifier(IP)}`, 1000)

    const { eventFindFirst, prisma } = makeFakePrismaWithFindFirstSpy({ tokenHash })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    // Exactly one Redis call — the broad guard's own. The token-hash
    // limiter (a second checkRateLimit) never runs.
    expect(evalMock).toHaveBeenCalledTimes(1)
    // getPhotographerEventFromToken's DB lookup never runs either — the
    // primary DB-protection acceptance criterion for this STEP.
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  it('999th allowed (under the 1000 ceiling), proceeds to the token-hash limiter', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`photographer-init-broad:ip:${hashIdentifier(IP)}`, 998)

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    expect(response.status).not.toBe(429)
    // Broad guard + token-hash limiter both ran.
    expect(evalMock).toHaveBeenCalledTimes(2)
  })

  it('arbitrary different (attacker-controlled) tokens from the same IP all consume the SAME broad bucket', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    // Every token is unresolvable (no matching prisma fixture) — exactly
    // the "arbitrary random token" abuse scenario. The broad guard must
    // still gate them all identically before any DB access is attempted.
    const { prisma: unresolvedPrisma } = makeFakePrismaWithFindFirstSpy({ tokenHash: 'never-matches' })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(unresolvedPrisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    for (let i = 0; i < 5; i++) {
      await POST(
        makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
        { params: { path: ['photographer-upload', generatePhotographerUploadToken(), 'init'] } },
      )
    }

    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const broadKey = `photographer-init-broad:ip:${hashIdentifier(IP)}`
    const broadKeyCalls = evalMock.mock.calls.filter((call) => call[1][0] === broadKey)
    expect(broadKeyCalls.length).toBe(5)
    // 5 distinct token-hash keys also fired (one per random token) — the
    // broad IP bucket is what actually bounds them, not the token bucket.
    const tokenKeyCalls = evalMock.mock.calls.filter((call) => call[1][0].startsWith('photographer-init:token:'))
    expect(new Set(tokenKeyCalls.map((c) => c[1][0])).size).toBe(5)
  })

  it('the same valid token from a different IP shares the SAME token-hash bucket (broad guard is per-IP, token bucket is not)', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }, { ip: IP }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )
    await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }, { ip: OTHER_IP }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    const tokenKeyCalls = evalMock.mock.calls.filter((call) => call[1][0] === `photographer-init:token:${tokenHash}`)
    expect(tokenKeyCalls.length).toBe(2)
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const broadKeysUsed = new Set(
      evalMock.mock.calls.filter((c) => c[1][0].startsWith('photographer-init-broad:ip:')).map((c) => c[1][0]),
    )
    expect(broadKeysUsed).toEqual(new Set([
      `photographer-init-broad:ip:${hashIdentifier(IP)}`,
      `photographer-init-broad:ip:${hashIdentifier(OTHER_IP)}`,
    ]))
  })

  it('Redis outage: broad guard backendError true, memory fallback under limit → proceeds to token limiter, never 503', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })
})

describe('completePhotographerUpload — broad pre-auth IP guard (photographer-complete-broad)', () => {
  it('sends a hashed IP key, never the raw IP, distinct category from the init broad guard', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(
      makeRequest({ sessionId: 'session-1' }),
      { params: { path: ['photographer-upload', token, 'complete'] } },
    )

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed[0]).toMatch(/^photographer-complete-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
    expect(keysUsed[0]).not.toContain('photographer-init-broad')
  })

  it('1000th allowed; 1001st blocked with zero token-limiter call and zero DB lookup', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`photographer-complete-broad:ip:${hashIdentifier(IP)}`, 1000)

    const { eventFindFirst, prisma } = makeFakePrismaWithFindFirstSpy({ tokenHash })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(
      makeRequest({ sessionId: 'session-1' }),
      { params: { path: ['photographer-upload', token, 'complete'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(evalMock).toHaveBeenCalledTimes(1)
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  it('init and complete broad buckets are independent — exhausting one does not block the other', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    // Exhaust ONLY the init broad bucket.
    counts.set(`photographer-init-broad:ip:${hashIdentifier(IP)}`, 1000)

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const initResponse = await POST(
      makeRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
      { params: { path: ['photographer-upload', token, 'init'] } },
    )
    const completeResponse = await POST(
      makeRequest({ sessionId: 'session-1' }),
      { params: { path: ['photographer-upload', token, 'complete'] } },
    )

    expect(initResponse.status).toBe(429)
    expect(completeResponse.status).not.toBe(429)
  })

  it('Redis outage: backendError true AND memory fallback limited → existing bare complete 429, never 503', async () => {
    const token = generatePhotographerUploadToken()
    const tokenHash = hashPhotographerUploadToken(token)
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ tokenHash }))

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doComplete = () =>
      POST(makeRequest({ sessionId: 'session-1' }), { params: { path: ['photographer-upload', token, 'complete'] } })

    let last
    for (let i = 0; i < 1001; i++) {
      last = await doComplete()
    }

    expect(last.status).not.toBe(503)
    expect(last.status).toBe(429)
    const body = await last.json()
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
  })
})
