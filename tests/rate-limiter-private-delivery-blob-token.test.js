import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BlobUploadKind } from '@prisma/client'

// STEP 7.12 — PRIVATE_DELIVERY sessions on the shared /api/uploads/blob
// token-generation branch move out of the legacy shared-IP limiter
// (upload-blob:ip:<clientIp>, 30/10min, in-memory) into their own
// eventId-scoped, Redis-backed bucket:
//   upload-blob:private-event:<eventId>, 200/10min
// mirroring the PHOTOGRAPHER_UPLOAD branch introduced in STEP 7.10a. The
// resolved BlobUploadSession lookup (uploadKind/eventId) is unchanged and
// reused as-is — no second DB query is added. ROOM_PHOTO and
// unresolved/malformed sessions remain on the legacy branch, unchanged.
// See tests/rate-limiter-photographer-blob-token.test.js for the sibling
// Photographer/Guest/broad-guard/callback coverage.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

// NOTE: rateLimit() is spied via vi.spyOn(module, 'rateLimit') inside each
// test that needs it (not vi.mock(..., importOriginal)) — partially mocking
// @/lib/server/rate-limiter via importOriginal was found to break
// resetModules()'s ability to reconstruct the module's redisClient
// singleton across tests within this file (see sibling photographer test
// file's note on this same precedent).
async function spyOnLegacyRateLimit() {
  const rlModule = await import('@/lib/server/rate-limiter')
  return vi.spyOn(rlModule, 'rateLimit')
}

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const IP = '203.0.113.77'
const EVENT_A = 'event-private-delivery-a'
const EVENT_B = 'event-private-delivery-b'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeTokenRequest({ clientPayload, ip = IP } = {}) {
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
    json: async () => ({
      type: 'blob.generate-client-token',
      payload: {
        pathname: 'private-delivery/wedding-2026/original.jpg',
        callbackUrl: `${ALLOWED_ORIGIN}/api/uploads/blob`,
        clientPayload: clientPayload === undefined ? JSON.stringify({ sessionId: 'session-id-999' }) : clientPayload,
        multipart: false,
      },
    }),
  }
}

function makePrismaWithSession(session) {
  const eventFindUnique = vi.fn()
  const eventFindFirst = vi.fn()
  const sessionFindUnique = vi.fn().mockResolvedValue(session)
  return {
    prisma: {
      blobUploadSession: { findUnique: sessionFindUnique },
      event: { findUnique: eventFindUnique, findFirst: eventFindFirst },
    },
    sessionFindUnique,
    eventFindUnique,
    eventFindFirst,
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
  process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token'
})

afterEach(() => {
  restoreEnv()
})

// ─── §17 Dispatch ───────────────────────────────────────────────────────────

describe('Private Delivery blob branch — upload-blob:private-event:<eventId>, 200/10min', () => {
  it('resolves the session, dispatches to the eventId-scoped bucket, and never calls the legacy rateLimit()', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique, eventFindUnique, eventFindFirst } = makePrismaWithSession({
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      eventId: EVENT_A,
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(sessionFindUnique).toHaveBeenCalledWith({ where: { id: 'session-id-999' }, select: { uploadKind: true, eventId: true } })
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`upload-blob:private-event:${EVENT_A}`)
    // No "double 30": the legacy limiter must never run for a resolved private-delivery session.
    expect(rateLimit).not.toHaveBeenCalled()
    // No extra DB query beyond the one pre-resolution BlobUploadSession lookup.
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  // ─── §18 Same-event sharing ───────────────────────────────────────────────

  it('two different sessions for the same event share one bucket; sessionId does not influence the key', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')

    getPrismaClient.mockResolvedValue(makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A }).prisma)
    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-aaa1' }) }), { params: { path: ['uploads', 'blob'] } })
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-bbb2' }) }), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    const eventKeys = keysUsed.filter((k) => k.startsWith('upload-blob:private-event:'))
    expect(eventKeys.filter((k) => k === `upload-blob:private-event:${EVENT_A}`).length).toBe(2)
  })

  // ─── §19 Different-event isolation ────────────────────────────────────────

  it('two PRIVATE_DELIVERY sessions on different events get distinct buckets — no owner/email lookup involved', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')

    getPrismaClient.mockResolvedValue(makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A }).prisma)
    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-ccc3' }) }), { params: { path: ['uploads', 'blob'] } })

    getPrismaClient.mockResolvedValue(makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_B }).prisma)
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-ddd4' }) }), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    const eventKeys = keysUsed.filter((k) => k.startsWith('upload-blob:private-event:'))
    expect(eventKeys.filter((k) => k === `upload-blob:private-event:${EVENT_A}`).length).toBe(1)
    expect(eventKeys.filter((k) => k === `upload-blob:private-event:${EVENT_B}`).length).toBe(1)
  })

  // ─── §20 Boundary ──────────────────────────────────────────────────────────

  it('the 200th request (exactly at the ceiling) is still allowed; the 201st is blocked with the exact bare 429 contract', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`upload-blob:private-event:${EVENT_A}`, 199)
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const allowedResponse = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })
    expect(allowedResponse.status).not.toBe(429)

    const blockedResponse = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })
    const body = await blockedResponse.json()
    expect(blockedResponse.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(blockedResponse.headers.get('Retry-After')).toBeNull()
  })

  // ─── §21 Redis outage ────────────────────────────────────────────────────

  it('Redis outage: backendError true, memory fallback under limit → continues, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })

  it('Redis outage: backendError true AND memory fallback limited → existing bare 429, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doRequest = () => POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    let last
    for (let i = 0; i < 201; i++) {
      last = await doRequest()
    }

    expect(last.status).not.toBe(503)
    expect(last.status).toBe(429)
    const body = await last.json()
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
  })

  // ─── §22 No extra DB query ──────────────────────────────────────────────

  it('uses exactly the same pre-resolution BlobUploadSession.findUnique as the Photographer dispatch — no Event query', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique, eventFindUnique, eventFindFirst } = makePrismaWithSession({
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      eventId: EVENT_A,
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(sessionFindUnique).toHaveBeenCalledTimes(1)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  // ─── §26 Key privacy ─────────────────────────────────────────────────────

  it('the key contains only the static category and the opaque eventId — never sessionId, ownerEmail, raw IP, or blob pathname', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-id-999' }) }), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    const eventKey = keysUsed.find((k) => k.startsWith('upload-blob:private-event:'))
    expect(eventKey).toBe(`upload-blob:private-event:${EVENT_A}`)
    expect(eventKey).not.toContain('session-id-999')
    expect(eventKey).not.toContain(IP)
    expect(eventKey).not.toContain('original.jpg')
  })
})

// ─── §23 Guest preservation ─────────────────────────────────────────────────

describe('Guest (ROOM_PHOTO) preservation — untouched legacy upload-blob:ip, 30/10min', () => {
  it('ROOM_PHOTO sessions still use the legacy raw-IP key/threshold; the new private-event limiter is never used', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.ROOM_PHOTO, eventId: 'event-guest-1' })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('upload-blob:private-event:'))).toBe(false)
  })
})

// ─── §24 Photographer preservation ─────────────────────────────────────────

describe('Photographer preservation — untouched upload-blob:photographer-event, 200/10min', () => {
  it('PHOTOGRAPHER_UPLOAD sessions still use their own eventId-scoped bucket — never the private-delivery key, never the legacy 30/IP limiter', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`upload-blob:photographer-event:${EVENT_A}`)
    expect(keysUsed).not.toContain(`upload-blob:private-event:${EVENT_A}`)
    expect(rateLimit).not.toHaveBeenCalled()
  })
})

// ─── §25 Malformed / unresolved ─────────────────────────────────────────────

describe('Malformed/unresolved sessions — unchanged legacy fallback, no crash', () => {
  it('nonexistent session (findUnique resolves null) falls through to the legacy branch', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(500)
    expect(sessionFindUnique).toHaveBeenCalledTimes(1)
    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
  })

  it('malformed clientPayload (not valid JSON) falls to the legacy branch, never queries the DB', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest({ clientPayload: 'not-json{{' }), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(500)
    expect(sessionFindUnique).not.toHaveBeenCalled()
    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
  })

  it('a resolved PRIVATE_DELIVERY session missing eventId falls through to the legacy branch, not the private-event bucket', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: null })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed.some((k) => k.startsWith('upload-blob:private-event:'))).toBe(false)
  })

  it('an unknown/unrecognized uploadKind falls through to the legacy branch', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: 'SOME_FUTURE_KIND', eventId: EVENT_A })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
  })
})
