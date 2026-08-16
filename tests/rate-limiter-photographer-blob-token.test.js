import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BlobUploadKind } from '@prisma/client'

// STEP 7.10a — /api/uploads/blob (shared by guest, private-delivery, and
// photographer) gains a two-stage rate-limit design on its token-generation
// branch:
//   1. A broad, Redis-backed, hashed-IP guard runs BEFORE any database
//      access — it exists purely to bound pre-lookup DB exposure from
//      arbitrary/random sessionId floods (see STEP 7.10a.0 §C). Raised
//      1000 -> 5000 in STEP 7.13c to give the Guest init/blob/complete
//      migration headroom for multiple concurrent events sharing one NAT'd
//      IP (see STEP 7.13b for the sizing analysis) — this guard is shared
//      across all three upload kinds.
//   2. A single read-only BlobUploadSession.findUnique({uploadKind,eventId})
//      resolves the flow. PHOTOGRAPHER_UPLOAD sessions get their own
//      eventId-scoped bucket (200/10min, deliberately NOT token-hash-scoped
//      — see STEP 7.10a.0 §H/§J for the token-rotation misattribution this
//      avoids). Everything else (ROOM_PHOTO, unresolved, malformed) falls
//      through UNCHANGED to the pre-existing legacy
//      rateLimit('upload-blob:ip:...', 30, 10min).
// The callback branch (blob.upload-completed) is untouched throughout.
//
// STEP 7.12 — PRIVATE_DELIVERY sessions were moved out of the "everything
// else" default branch into their own eventId-scoped bucket
// (upload-blob:private-event:<eventId>, 200/10min), mirroring the
// photographer branch above. See tests/rate-limiter-private-delivery-blob-token.test.js
// for full coverage of that dispatch.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

// NOTE: rateLimit() is spied via vi.spyOn(module, 'rateLimit') inside each
// test that needs it (not vi.mock(..., importOriginal)) — partially mocking
// @/lib/server/rate-limiter via importOriginal was found to break
// resetModules()'s ability to reconstruct the module's redisClient
// singleton across tests within this file, causing a stale Redis mock to
// leak from one test into the next.
async function spyOnLegacyRateLimit() {
  const rlModule = await import('@/lib/server/rate-limiter')
  return vi.spyOn(rlModule, 'rateLimit')
}

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const IP = '203.0.113.42'
const PHOTOGRAPHER_EVENT_ID = 'event-photographer-1'
const OTHER_EVENT_ID = 'event-photographer-2'

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
        pathname: 'private-delivery/wedding-2026/photo.jpg',
        callbackUrl: `${ALLOWED_ORIGIN}/api/uploads/blob`,
        clientPayload: clientPayload === undefined ? JSON.stringify({ sessionId: 'session-id-123' }) : clientPayload,
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

// ─── Broad pre-DB guard ──────────────────────────────────────────────────

describe('Broad pre-DB guard — blob-token-broad:ip:<hashed>, 5000/10min', () => {
  it('sends a hashed IP key to Redis, never the raw IP', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrismaWithSession(null).prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed[0]).toMatch(/^blob-token-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
  })

  it('the 5001st request on one broad bucket is blocked with zero BlobUploadSession lookups', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    // Pre-seed the broad bucket to exactly 5000 (already at the ceiling) so
    // this test needs only ONE additional route call, not 5001.
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`blob-token-broad:ip:${hashIdentifier(IP)}`, 5000)

    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    // The hard pre-DB invariant: blocked by the broad guard means the
    // session lookup never runs at all.
    expect(sessionFindUnique).not.toHaveBeenCalled()
  })

  it('the 5000th request (exactly at the ceiling) is still allowed through to session resolution', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`blob-token-broad:ip:${hashIdentifier(IP)}`, 4999)

    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(429)
    expect(sessionFindUnique).toHaveBeenCalledTimes(1)
  })

  it('Redis outage: backendError true, memory fallback under limit → continues, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { prisma } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(evalMock).toHaveBeenCalled()
    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
  })
})

// ─── Photographer branch ────────────────────────────────────────────────

describe('Photographer blob branch — upload-blob:photographer-event:<eventId>, 200/10min', () => {
  it('resolves the session, dispatches to the eventId-scoped bucket, and never calls the legacy rateLimit()', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique, eventFindUnique, eventFindFirst } = makePrismaWithSession({
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      eventId: PHOTOGRAPHER_EVENT_ID,
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(sessionFindUnique).toHaveBeenCalledWith({ where: { id: 'session-id-123' }, select: { uploadKind: true, eventId: true } })
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`upload-blob:photographer-event:${PHOTOGRAPHER_EVENT_ID}`)
    expect(keysUsed.some((k) => k.includes('session-id-123'))).toBe(false)
    // No "double 30": the legacy limiter must never run for a resolved photographer session.
    expect(rateLimit).not.toHaveBeenCalled()
    // No Event hop — eventId alone (already on the session) is sufficient.
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  it('blocks the 201st photographer-event request with the exact bare 429 contract', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`upload-blob:photographer-event:${PHOTOGRAPHER_EVENT_ID}`, 200)
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: PHOTOGRAPHER_EVENT_ID })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('the 200th request (exactly at the ceiling) is still allowed', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set(`upload-blob:photographer-event:${PHOTOGRAPHER_EVENT_ID}`, 199)
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: PHOTOGRAPHER_EVENT_ID })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(429)
  })

  it('two sessions for the same event share one bucket; a different event gets a different bucket', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')

    getPrismaClient.mockResolvedValue(
      makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: PHOTOGRAPHER_EVENT_ID }).prisma,
    )
    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-aaa1' }) }), { params: { path: ['uploads', 'blob'] } })
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-bbb2' }) }), { params: { path: ['uploads', 'blob'] } })

    getPrismaClient.mockResolvedValue(
      makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: OTHER_EVENT_ID }).prisma,
    )
    await POST(makeTokenRequest({ clientPayload: JSON.stringify({ sessionId: 'session-ccc3' }) }), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    const photographerKeys = keysUsed.filter((k) => k.startsWith('upload-blob:photographer-event:'))
    expect(photographerKeys.filter((k) => k === `upload-blob:photographer-event:${PHOTOGRAPHER_EVENT_ID}`).length).toBe(2)
    expect(photographerKeys.filter((k) => k === `upload-blob:photographer-event:${OTHER_EVENT_ID}`).length).toBe(1)
  })

  it('token-rotation regression: identity depends only on session.eventId, never on the event row / current token hash', async () => {
    // Simulates a session created under token A whose event has since had
    // its photographerUploadTokenHash rotated to token B. The blob-stage
    // limiter must never consult the Event row at all.
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, eventFindUnique, eventFindFirst } = makePrismaWithSession({
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      eventId: PHOTOGRAPHER_EVENT_ID,
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain(`upload-blob:photographer-event:${PHOTOGRAPHER_EVENT_ID}`)
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  it('Redis outage: backendError true AND memory fallback limited → existing bare 429, never 503', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    await setupRedis({ eval: evalMock, ttl: vi.fn() })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, eventId: PHOTOGRAPHER_EVENT_ID })
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
})

// ─── Guest (ROOM_PHOTO) branch ──────────────────────────────────────────
// STEP 7.13c — ROOM_PHOTO sessions were moved out of the "everything else"
// default branch into their own eventId-scoped bucket
// (upload-blob:guest-event:<eventId>, 1500/10min), mirroring the
// photographer/private-delivery branches above. The 1500 ceiling is
// deliberately ABOVE guestInitEvent/guestCompleteEvent's 1000 — see STEP
// 7.13b/7.13c for the asymmetric-threshold rationale.

describe('Guest (ROOM_PHOTO) blob branch — upload-blob:guest-event:<eventId>, 1500/10min', () => {
  it('resolves the session, dispatches to the eventId-scoped bucket, and never calls the legacy rateLimit()', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique, eventFindUnique, eventFindFirst } = makePrismaWithSession({
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      eventId: 'event-guest-1',
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(sessionFindUnique).toHaveBeenCalledWith({ where: { id: 'session-id-123' }, select: { uploadKind: true, eventId: true } })
    const keysUsed = evalMock.mock.calls.map((call) => call[1][0])
    expect(keysUsed).toContain('upload-blob:guest-event:event-guest-1')
    // No "double 30": the legacy limiter must never run for a resolved Guest session.
    expect(rateLimit).not.toHaveBeenCalled()
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(eventFindFirst).not.toHaveBeenCalled()
  })

  it('blocks the 1501st guest-event request with the exact bare 429 contract', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set('upload-blob:guest-event:event-guest-1', 1500)
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.ROOM_PHOTO, eventId: 'event-guest-1' })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('the 1500th request (exactly at the ceiling) is still allowed', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    counts.set('upload-blob:guest-event:event-guest-1', 1499)
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.ROOM_PHOTO, eventId: 'event-guest-1' })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(429)
  })
})

// ─── Default branch: Private Delivery (pre-7.12) / unresolved / malformed ─

describe('Default branch — unchanged legacy upload-blob:ip, 30/10min', () => {
  it('PRIVATE_DELIVERY sessions no longer use this legacy IP limiter as of STEP 7.12 — see tests/rate-limiter-private-delivery-blob-token.test.js', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession({ uploadKind: BlobUploadKind.PRIVATE_DELIVERY, eventId: 'event-owner-1' })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('nonexistent session (findUnique resolves null) falls through to the legacy branch, no crash', async () => {
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

  it('malformed clientPayload (not valid JSON) is treated as unresolved, no crash, falls to legacy branch, and never queries the DB', async () => {
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

  it('missing clientPayload is treated as unresolved, no crash, falls to legacy branch', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const { POST } = await import('@/app/api/[[...path]]/route')
    const response = await POST(makeTokenRequest({ clientPayload: null }), { params: { path: ['uploads', 'blob'] } })

    expect(response.status).not.toBe(500)
    expect(sessionFindUnique).not.toHaveBeenCalled()
    expect(rateLimit).toHaveBeenCalledWith(`upload-blob:ip:${IP}`, 30, 10 * 60 * 1000)
  })

  it('legacy 429 body/status/header shape is byte-identical to before this STEP', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { POST } = await import('@/app/api/[[...path]]/route')
    const doRequest = () => POST(makeTokenRequest(), { params: { path: ['uploads', 'blob'] } })

    let last
    for (let i = 0; i < 31; i++) {
      last = await doRequest()
    }
    const body = await last.json()

    expect(last.status).toBe(429)
    expect(body).toEqual({ error: 'Too many upload attempts. Please try again later.' })
    expect(last.headers.get('Retry-After')).toBeNull()
  })
})

// ─── Callback branch hard stop ─────────────────────────────────────────────

describe('Callback branch (blob.upload-completed) is untouched by any of the new logic', () => {
  it('no rate limiting or session-resolution work runs for a callback request', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, sessionFindUnique } = makePrismaWithSession(null)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const rateLimit = await spyOnLegacyRateLimit()

    const request = {
      method: 'POST',
      headers: { get: (name) => (name === 'origin' ? ALLOWED_ORIGIN : null) },
      cookies: { get: () => undefined },
      json: async () => ({ type: 'blob.upload-completed', payload: {} }),
    }

    const { POST } = await import('@/app/api/[[...path]]/route')
    await POST(request, { params: { path: ['uploads', 'blob'] } })

    expect(evalMock).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
    // The broad guard and photographer-branch lookup both only run for
    // non-callback requests — the callback path never calls
    // blobUploadSession.findUnique from the NEW pre-limit logic (it may
    // still be touched deeper inside onUploadCompleted, which is real
    // Vercel-signature-authenticated business logic unrelated to this STEP).
    expect(sessionFindUnique).not.toHaveBeenCalled()
  })
})
