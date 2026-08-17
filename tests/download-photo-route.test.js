import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

// STEP 7.14a — first real coverage for GET /api/download/photo.
//
// Locks down:
//   - the new broad, Redis-backed, hashed-IP pre-DB guard
//     (download-photo-broad:ip:<sha256>, 5000/10min, fail-open);
//   - the branded response contract (JPEG bytes, image/jpeg, .jpg filename);
//   - the unbranded passthrough remaining byte-for-byte unchanged;
//   - that authorization/visibility failures never reach Blob or Sharp.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const IP = '203.0.113.55'
const EVENT_ID = 'event-1'
const SLUG = 'wedding-2026'
const PHOTO_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding-2026/uuid-beach.png'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ photoUrl = PHOTO_URL, eventSlug = SLUG, type = 'standard', ip = IP } = {}) {
  const params = new URLSearchParams()
  if (photoUrl !== null) params.set('photoUrl', photoUrl)
  if (eventSlug !== null) params.set('eventSlug', eventSlug)
  if (type !== null) params.set('type', type)
  return {
    url: `${ALLOWED_ORIGIN}/api/download/photo?${params.toString()}`,
    headers: { get: (name) => (name === 'x-forwarded-for' ? ip : null) },
  }
}

/** A real PNG so format assertions are meaningful, not mocked bytes. */
async function pngSource(w = 600, h = 400) {
  const buf = Buffer.alloc(w * h * 3)
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 256
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}

function makePrisma({ event, photo, ownerPlan = null } = {}) {
  const eventFindUnique = vi.fn().mockResolvedValue(event)
  const photoFindFirst = vi.fn().mockResolvedValue(photo)
  const ownerFindUnique = vi.fn().mockResolvedValue(ownerPlan ? { plan: ownerPlan } : null)
  return {
    prisma: {
      event: { findUnique: eventFindUnique },
      photo: { findFirst: photoFindFirst },
      owner: { findUnique: ownerFindUnique },
    },
    eventFindUnique,
    photoFindFirst,
  }
}

const FREE_EVENT = { id: EVENT_ID, slug: SLUG, billingTier: null, originalDownloadUnlocked: false, ownerId: null }
const PAID_EVENT = { id: EVENT_ID, slug: SLUG, billingTier: 'pro_event', originalDownloadUnlocked: false, ownerId: null }
const PHOTO = { id: 'photo-1', originalName: 'beach.png', storedName: 'uuid-beach.png', mimeType: 'image/png', url: PHOTO_URL }

function installHealthyRedisMock() {
  const counts = new Map()
  const evalMock = vi.fn(async (_script, keys) => {
    const key = keys[0]
    const next = (counts.get(key) || 0) + 1
    counts.set(key, next)
    return next
  })
  return { evalMock, ttlMock: vi.fn(async () => 300), counts }
}

async function setupRedis(impl) {
  const { Redis } = await import('@upstash/redis')
  Redis.mockImplementation(function () { return impl })
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'

  const source = await pngSource()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  })
})

afterEach(() => {
  restoreEnv()
})

async function callRoute(requestOverrides) {
  const { GET } = await import('@/app/api/download/photo/route')
  return GET(makeRequest(requestOverrides))
}

function dispositionFilename(response) {
  const raw = response.headers.get('content-disposition')
  const match = raw?.match(/filename="([^"]+)"/)
  return match ? decodeURIComponent(match[1]) : null
}

describe('parameter validation', () => {
  it('missing photoUrl → 400, unchanged message', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const response = await callRoute({ photoUrl: null })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'photoUrl is required' })
  })

  it('missing eventSlug → 400, unchanged message', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })

    const response = await callRoute({ eventSlug: null })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'eventSlug is required' })
  })
})

describe('broad pre-DB guard — download-photo-broad:ip:<hashed>, 5000/10min', () => {
  it('sends a hashed IP key to Redis, never the raw IP', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    await callRoute()

    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed[0]).toMatch(/^download-photo-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
  })

  it('a limited request returns the exact bare 429 and never touches DB, Blob, or Sharp', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`download-photo-broad:ip:${hashIdentifier(IP)}`, 5000)

    const { prisma, eventFindUnique, photoFindFirst } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute()

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Too many download requests. Please try again later.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(photoFindFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the 5000th request is allowed; the 5001st is blocked', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)
    const key = `download-photo-broad:ip:${hashIdentifier(IP)}`

    counts.set(key, 4999)
    expect((await callRoute()).status).not.toBe(429)

    counts.set(key, 5000)
    expect((await callRoute()).status).toBe(429)
  })

  it('the 429 body carries no code, retryAfter, or Retry-After header', async () => {
    const { evalMock, ttlMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { hashIdentifier } = await import('@/lib/server/rate-limiter')
    counts.set(`download-photo-broad:ip:${hashIdentifier(IP)}`, 5000)
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()
    const body = await response.json()

    expect(Object.keys(body)).toEqual(['error'])
    expect(body.code).toBeUndefined()
    expect(body.retryAfter).toBeUndefined()
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  it('Redis outage with the memory fallback under limit → continues, never 503', async () => {
    await setupRedis({ eval: vi.fn().mockRejectedValue(new Error('ECONNRESET')), ttl: vi.fn() })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.status).not.toBe(503)
    expect(response.status).not.toBe(429)
    expect(response.status).toBe(200)
  })

  it('Redis outage with the memory fallback limited → same bare 429, never 503', async () => {
    await setupRedis({ eval: vi.fn().mockRejectedValue(new Error('ECONNRESET')), ttl: vi.fn() })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const { prisma, eventFindUnique } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    getPrismaClient.mockResolvedValue(prisma)

    // Drive the shared in-memory fallback bucket to its ceiling directly
    // rather than issuing 5000 real route calls (each of which would run a
    // full Sharp transform). Same module singleton, same key the route uses.
    const { checkRateLimit, hashIdentifier, RATE_LIMITS } = await import('@/lib/server/rate-limiter')
    const key = `download-photo-broad:ip:${hashIdentifier(IP)}`
    for (let i = 0; i < RATE_LIMITS.downloadPhotoBroad.ip.max; i++) {
      await checkRateLimit(key, RATE_LIMITS.downloadPhotoBroad.ip.max, RATE_LIMITS.downloadPhotoBroad.ip.window)
    }

    const response = await callRoute()

    expect(response.status).not.toBe(503)
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Too many download requests. Please try again later.' })
    // Still fails open in the sense that matters: it is the quota, not the
    // Redis failure, that produced the 429 — and no DB work occurred.
    expect(eventFindUnique).not.toHaveBeenCalled()
  })
})

describe('authorization / visibility must precede any expensive work', () => {
  it('unknown event → 404, no photo lookup, no Blob fetch, no Sharp', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, photoFindFirst } = makePrisma({ event: null, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Event not found' })
    expect(photoFindFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('photo not found / not VISIBLE → 404, no Blob fetch, no Sharp', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, photoFindFirst } = makePrisma({ event: FREE_EVENT, photo: null })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Photo not found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the visibility filter still requires status VISIBLE and scopes to the event', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { prisma, photoFindFirst } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    await callRoute()

    expect(photoFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: EVENT_ID, url: PHOTO_URL, status: 'VISIBLE' },
      })
    )
  })

  it('database unavailable → 503, unchanged', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(null)

    const response = await callRoute()

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('branded response contract (Free event)', () => {
  it('returns 200 with real JPEG bytes, image/jpeg, and a .jpg filename', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(dispositionFilename(response)).toBe('beach.jpg')

    // The bytes really are JPEG — a PNG source was transcoded.
    const body = Buffer.from(await response.arrayBuffer())
    expect((await sharp(body).metadata()).format).toBe('jpeg')
  })

  it('never advertises the source PNG type or extension for JPEG bytes', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.headers.get('content-type')).not.toBe('image/png')
    expect(dispositionFilename(response)).not.toMatch(/\.png$/)
  })

  it('preserves the existing Cache-Control contract', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  })
})

describe('unbranded regression (paid event) — passthrough unchanged', () => {
  it('serves the source bytes untouched with the source Content-Type and extension', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(dispositionFilename(response)).toBe('beach.png')
    // Still PNG: the unbranded path must not enter JPEG-mode processing.
    expect((await sharp(body).metadata()).format).toBe('png')
  })

  it('does not transcode — the unbranded body is byte-identical to the source', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const source = await pngSource()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    })

    const response = await callRoute()
    const body = Buffer.from(await response.arrayBuffer())

    expect(Buffer.compare(body, source)).toBe(0)
  })
})

describe('type parameter has no effect on the output contract (unchanged)', () => {
  it('type=original and type=standard produce the same Content-Type and filename', async () => {
    const { evalMock, ttlMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const standard = await callRoute({ type: 'standard' })
    const original = await callRoute({ type: 'original' })

    expect(original.headers.get('content-type')).toBe(standard.headers.get('content-type'))
    expect(dispositionFilename(original)).toBe(dispositionFilename(standard))
  })
})
