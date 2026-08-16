import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BlobUploadKind } from '@prisma/client'

// STEP 7.13c — migrates completeUpload (Guest room-photo upload completion,
// /api/uploads/complete) from the legacy, always-in-memory, raw-IP-scoped
// rateLimit() to:
//   1. guest-complete-broad:ip:<hashed>, 5000/10min — runs before any DB
//      access, including the vercel-blob/local-path branch decision.
//   2. A read-only BlobUploadSession pre-resolution lookup selecting
//      { eventId, uploadKind } — NOT just eventId (the STEP 7.13c review
//      correction). guest-complete-event:<eventId>, 1000/10min applies
//      ONLY when uploadKind === ROOM_PHOTO && eventId exists. A
//      Photographer/Private-Delivery/unresolved session presented here
//      must never poison this bucket.
// completeRoomPhotoBlobUpload remains the sole authoritative source for
// session state/claiming — mocked here so these tests isolate the
// rate-limiter dispatch, not the completion transaction itself (covered by
// tests/blob-upload-completion.test.js).

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn().mockResolvedValue({
    getEventBySlug: vi.fn().mockResolvedValue({ id: 'event-guest-1', slug: 'wedding-2026' }),
  }),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getStorageDriver: vi.fn().mockReturnValue({ mode: 'vercel-blob' }),
  }
})

vi.mock('@/lib/server/blob-upload-completion', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    completeRoomPhotoBlobUpload: vi.fn().mockResolvedValue({
      photo: { id: 'photo-1' },
      eventSlug: 'wedding-2026',
      idempotent: false,
    }),
  }
})

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const EVENT_ID = 'event-guest-1'
const OTHER_EVENT_ID = 'event-guest-2'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const IP = '198.51.100.30'
const OTHER_IP = '198.51.100.31'
const SESSION_ID = 'guest-session-abc123'

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

function makePrismaWithSession(session) {
  const sessionFindUnique = vi.fn().mockResolvedValue(session)
  return {
    prisma: { blobUploadSession: { findUnique: sessionFindUnique } },
    sessionFindUnique,
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

async function doComplete(body = { sessionId: SESSION_ID }, { ip = IP } = {}) {
  const { POST } = await import('@/app/api/[[...path]]/route')
  return POST(makeRequest(body, { ip }), { params: { path: ['uploads', 'complete'] } })
}

describe('Guest complete — broad pre-DB guard', () => {
  it('sends a hashed IP key to Redis before any BlobUploadSession lookup', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { prisma, sessionFindUnique } = makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await doComplete()

    expect(response.status).not.toBe(429)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed[0]).toMatch(/^guest-complete-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
    expect(sessionFindUnique).toHaveBeenCalledTimes(1)
  })

  it('a broad-blocked request never performs the BlobUploadSession pre-resolution lookup', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`guest-complete-broad:ip:${hashIdentifier(IP)}`, 5000)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { prisma, sessionFindUnique } = makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO })
    getPrismaClient.mockResolvedValue(prisma)

    const response = await doComplete()
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(sessionFindUnique).not.toHaveBeenCalled()
  })

  it('the 5000th broad request is still allowed; the 5001st is blocked', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    counts.set(`guest-complete-broad:ip:${hashIdentifier(IP)}`, 4999)
    const allowed = await doComplete()
    expect(allowed.status).not.toBe(429)

    counts.set(`guest-complete-broad:ip:${hashIdentifier(IP)}`, 5000)
    const blocked = await doComplete()
    expect(blocked.status).toBe(429)
  })

  it('Redis outage: backendError true, memory fallback under limit → continues, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    const response = await doComplete()

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })
})

describe('Guest complete — pre-resolution lookup selects eventId AND uploadKind', () => {
  it('the findUnique select shape is exactly { eventId: true, uploadKind: true }', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { prisma, sessionFindUnique } = makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO })
    getPrismaClient.mockResolvedValue(prisma)

    await doComplete()

    expect(sessionFindUnique).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      select: { eventId: true, uploadKind: true },
    })
  })
})

describe('Guest complete — ROOM_PHOTO-only primary limiter', () => {
  it('a resolved ROOM_PHOTO session with an eventId increments guest-complete-event', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    await doComplete()

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`guest-complete-event:${EVENT_ID}`)
  })

  it('blocks the 1001st request for the same Guest event with the exact bare 429 contract', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`guest-complete-event:${EVENT_ID}`, 1000)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    const response = await doComplete()
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload completions. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('the 1000th request (exactly at the ceiling) is still allowed through to completeRoomPhotoBlobUpload', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`guest-complete-event:${EVENT_ID}`, 999)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)
    const { completeRoomPhotoBlobUpload } = await import('@/lib/server/blob-upload-completion')

    const response = await doComplete()

    expect(response.status).not.toBe(429)
    expect(completeRoomPhotoBlobUpload).toHaveBeenCalledTimes(1)
  })

  it('two IPs completing sessions for the same event share one event bucket', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    await doComplete({ sessionId: SESSION_ID }, { ip: IP })
    await doComplete({ sessionId: 'guest-session-def456' }, { ip: OTHER_IP })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.filter((k) => k === `guest-complete-event:${EVENT_ID}`)).toHaveLength(2)
    const broadKeys = new Set(keysUsed.filter((k) => k.startsWith('guest-complete-broad:ip:')))
    expect(broadKeys.size).toBe(2)
  })
})

describe('Guest complete — cross-flow hard invariant (STEP 7.13c review correction)', () => {
  it('a PHOTOGRAPHER_UPLOAD session never increments guest-complete-event, but still reaches completeRoomPhotoBlobUpload', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: 'event-photographer-1', uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD }).prisma)
    const { completeRoomPhotoBlobUpload } = await import('@/lib/server/blob-upload-completion')

    const response = await doComplete()

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-complete-event:'))).toBe(false)
    expect(completeRoomPhotoBlobUpload).toHaveBeenCalledTimes(1)
    expect(response.status).not.toBe(429)
  })

  it('a PRIVATE_DELIVERY session never increments guest-complete-event, but still reaches completeRoomPhotoBlobUpload', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: 'event-owner-1', uploadKind: BlobUploadKind.PRIVATE_DELIVERY }).prisma)
    const { completeRoomPhotoBlobUpload } = await import('@/lib/server/blob-upload-completion')

    const response = await doComplete()

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-complete-event:'))).toBe(false)
    expect(completeRoomPhotoBlobUpload).toHaveBeenCalledTimes(1)
    expect(response.status).not.toBe(429)
  })

  it('flooding guest-complete-event via 1000 Photographer-kind completions on event-A does not block a subsequent ROOM_PHOTO completion on event-A', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`guest-complete-event:${EVENT_ID}`, 1000) // already saturated, but never touched by non-ROOM_PHOTO
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: EVENT_ID, uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD }).prisma)

    const response = await doComplete()

    // Photographer-kind session must not even consult the saturated bucket.
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-complete-event:'))).toBe(false)
    expect(response.status).not.toBe(429)
  })
})

describe('Guest complete — invalid/unresolved session (Option A)', () => {
  it('a nonexistent session (findUnique resolves null) never creates a synthetic bucket, and still reaches completeRoomPhotoBlobUpload', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    getPrismaClient.mockResolvedValue(prisma)
    const { completeRoomPhotoBlobUpload } = await import('@/lib/server/blob-upload-completion')

    const response = await doComplete()

    expect(sessionFindUnique).toHaveBeenCalledTimes(1)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-complete-event:'))).toBe(false)
    expect(keysUsed.some((k) => k.includes(SESSION_ID))).toBe(false)
    expect(completeRoomPhotoBlobUpload).toHaveBeenCalledTimes(1)
    expect(response.status).not.toBe(500)
  })

  it('a resolved session with a null eventId never increments any event bucket', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession({ eventId: null, uploadKind: BlobUploadKind.ROOM_PHOTO }).prisma)

    const response = await doComplete()

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('guest-complete-event:'))).toBe(false)
    expect(response.status).not.toBe(429)
  })
})

describe('Guest complete — legacy upload-complete:ip is gone', () => {
  it('the route source no longer contains the legacy rateLimit(`upload-complete:ip:...`) call', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const source = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
    expect(source).not.toContain('upload-complete:ip:')
  })
})
