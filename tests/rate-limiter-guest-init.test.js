import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// STEP 7.13c — migrates initUpload (Guest room-photo upload initiation,
// /api/uploads/init) from the legacy, always-in-memory, raw-IP-scoped
// rateLimit() to a two-stage Redis-backed design:
//   1. guest-init-broad:ip:<hashed>, 5000/10min — runs before any DB access.
//   2. guest-init-event:<eventId>, 1000/10min — runs once the Event has been
//      resolved via getEventBySlug, before entitlement checks or
//      BlobUploadSession creation.
// See STEP 7.13b for the full sizing/design rationale (the asymmetric
// 1000/1500 init/blob relationship in particular).

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

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
const EVENT_ID = 'event-guest-1'
const OTHER_EVENT_ID = 'event-guest-2'
const SLUG = 'wedding-2026'
const OTHER_SLUG = 'wedding-2027'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const IP = '198.51.100.20'
const OTHER_IP = '198.51.100.21'

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

const INIT_PAYLOAD = { eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }

function makeFakePrisma() {
  return {
    blobUploadSession: {
      create: async ({ data }) => ({ id: 'guest-session-x', status: 'PENDING', ...data }),
      findUnique: async () => null,
    },
  }
}

function eventFixture(id = EVENT_ID, slug = SLUG) {
  // billingTier 'wedding_pro' -> canUploadUnlimited, bypassing photo.count
  // and the owner lookup entirely — these tests are about the rate
  // limiter, not entitlement logic.
  return { id, slug, billingTier: 'wedding_pro' }
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

async function doInit(body = INIT_PAYLOAD, { ip = IP } = {}) {
  const { POST } = await import('@/app/api/[[...path]]/route')
  return POST(makeRequest(body, { ip }), { params: { path: ['uploads', 'init'] } })
}

describe('Guest init — broad pre-DB guard', () => {
  it('sends a hashed IP key to Redis before touching the repository', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const getEventBySlug = vi.fn().mockResolvedValue(eventFixture())
    getGalleryRepository.mockResolvedValue({ getEventBySlug })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const response = await doInit()

    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed[0]).toMatch(/^guest-init-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
    expect(keysUsed).toContain(`guest-init-event:${EVENT_ID}`)
  })

  it('a broad-blocked request never calls getEventBySlug, checks entitlement, or creates a session', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`guest-init-broad:ip:${hashIdentifier(IP)}`, 5000)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const getEventBySlug = vi.fn().mockResolvedValue(eventFixture())
    getGalleryRepository.mockResolvedValue({ getEventBySlug })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const prisma = makeFakePrisma()
    const createSpy = vi.spyOn(prisma.blobUploadSession, 'create')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await doInit()
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(getEventBySlug).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('the 5000th broad request is still allowed; the 5001st is blocked', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    counts.set(`guest-init-broad:ip:${hashIdentifier(IP)}`, 4999)
    const allowed = await doInit()
    expect(allowed.status).not.toBe(429)

    counts.set(`guest-init-broad:ip:${hashIdentifier(IP)}`, 5000)
    const blocked = await doInit()
    expect(blocked.status).toBe(429)
  })

  it('Redis outage: backendError true, memory fallback under limit → continues, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const response = await doInit()

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })
})

describe('Guest init — event-scoped primary limiter', () => {
  it('runs only after the Event is resolved, keyed on event.id (not slug, not IP)', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    await doInit()

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`guest-init-event:${EVENT_ID}`)
    expect(keysUsed.some((k) => k.includes(SLUG))).toBe(false)
  })

  it('event.id not found (404) never reaches the event-scoped limiter', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(null) })

    const response = await doInit()

    expect(response.status).toBe(404)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-init-event:'))).toBe(false)
  })

  it('blocks the 1001st request for the same event with the exact bare 429 contract', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`guest-init-event:${EVENT_ID}`, 1000)
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const response = await doInit()
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('the 1000th request (exactly at the ceiling) is still allowed', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`guest-init-event:${EVENT_ID}`, 999)
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const response = await doInit()

    expect(response.status).not.toBe(429)
  })

  it('two Guest IPs on the same event share one event bucket, but keep separate broad-IP buckets', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    await doInit(INIT_PAYLOAD, { ip: IP })
    await doInit(INIT_PAYLOAD, { ip: OTHER_IP })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.filter((k) => k === `guest-init-event:${EVENT_ID}`)).toHaveLength(2)
    const broadKeys = new Set(keysUsed.filter((k) => k.startsWith('guest-init-broad:ip:')))
    expect(broadKeys.size).toBe(2)
  })

  it('different events on the same IP get different event buckets', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      getEventBySlug: vi.fn(async (slug) => (slug === SLUG ? eventFixture(EVENT_ID, SLUG) : eventFixture(OTHER_EVENT_ID, OTHER_SLUG))),
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    await doInit({ ...INIT_PAYLOAD, eventSlug: SLUG })
    await doInit({ ...INIT_PAYLOAD, eventSlug: OTHER_SLUG })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`guest-init-event:${EVENT_ID}`)
    expect(keysUsed).toContain(`guest-init-event:${OTHER_EVENT_ID}`)
  })

  it('Redis outage: backendError true AND memory fallback limited → existing bare 429, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(eventFixture()) })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    let last
    for (let i = 0; i < 1001; i++) {
      last = await doInit()
    }

    expect(last.status).not.toBe(503)
    expect(last.status).toBe(429)
    const body = await last.json()
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
  })
})

describe('Guest init — legacy upload-init:ip is gone', () => {
  it('the route source no longer contains the legacy rateLimit(`upload-init:ip:...`) call', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
    expect(source).not.toContain('upload-init:ip:')
  })
})
