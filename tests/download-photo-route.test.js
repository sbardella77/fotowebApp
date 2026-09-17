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
//
// STEP 7.14b — branded downloads now resolve through the derivative cache.
// The Blob layer is mocked here so the route-level response contract can be
// asserted for both a cache MISS (winner produces and returns the generated
// buffer) and a cache HIT (stored bytes served), plus the two new temporary
// 503 mappings. Derivative/lock concurrency itself is covered in
// tests/download-photo-derivative.test.js.
//
// TASK-03 (Phase 1A) — the request contract changed from
// photoUrl+eventSlug to a single opaque photoId. The photo lookup now
// happens FIRST (by id + status), and the event is derived from the
// found photo's own eventId — never trusted from the client. This file
// was updated to match: every test that asserted on the old lookup order
// or param names has been rewritten; nothing about the branded/unbranded/
// derivative-cache/rate-limit behavior itself changed, and those
// assertions are preserved as-is.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

const blobHeadMock = vi.fn()
const blobPutMock = vi.fn()
class FakeBlobNotFoundError extends Error {
  constructor() {
    super('The requested blob does not exist')
    this.name = 'BlobNotFoundError'
  }
}
vi.mock('@vercel/blob', () => ({
  head: (...args) => blobHeadMock(...args),
  put: (...args) => blobPutMock(...args),
  BlobNotFoundError: FakeBlobNotFoundError,
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const DERIVATIVE_URL = 'https://store123.public.blob.vercel-storage.com/derivatives/wm-v2/photo-1.jpg'
const DERIVATIVE_PATH = 'derivatives/wm-v2/photo-1.jpg'
// Download Representation Contract v1: paid Standard now resolves through
// the display-v1 derivative — its own Blob cache namespace, entirely
// separate from the Free-event branded wm-v2 one above. Tests that need to
// prove "the branded path isn't used" must assert against THIS path/lock
// namespace, not against zero Blob activity globally.
const DISPLAY_DERIVATIVE_URL = 'https://store123.public.blob.vercel-storage.com/derivatives/display-v1/photo-1.jpg'
const DISPLAY_DERIVATIVE_PATH = 'derivatives/display-v1/photo-1.jpg'
const DISPLAY_TRANSFORM_LOCK_KEY = 'display-photo-transform:v1:photo-1'
/** In-memory stand-in for the Blob store, so a put makes later heads succeed. */
const storedDerivatives = new Map()

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const IP = '203.0.113.55'
const EVENT_ID = 'event-1'
const SLUG = 'wedding-2026'
const PHOTO_ID = 'photo-1'
const PHOTO_URL = 'https://store123.public.blob.vercel-storage.com/events/wedding-2026/uuid-beach.png'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeRequest({ photoId = PHOTO_ID, type = 'standard', ip = IP, extraParams = {} } = {}) {
  const params = new URLSearchParams()
  if (photoId !== null) params.set('photoId', photoId)
  if (type !== null) params.set('type', type)
  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== null) params.set(key, value)
  }
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
const PHOTO = { id: PHOTO_ID, eventId: EVENT_ID, originalName: 'beach.png', storedName: 'uuid-beach.png', mimeType: 'image/png', url: PHOTO_URL }

function installHealthyRedisMock() {
  const counts = new Map()
  const evalMock = vi.fn(async (_script, keys) => {
    const key = keys[0]
    const next = (counts.get(key) || 0) + 1
    counts.set(key, next)
    return next
  })
  // SET ... NX semantics, so branded requests exercise the real ACQUIRED
  // lock path rather than silently degrading to local single-flight.
  const locks = new Set()
  const setMock = vi.fn(async (key, _value, opts) => {
    if (opts?.nx && locks.has(key)) return null
    locks.add(key)
    return 'OK'
  })
  return { evalMock, ttlMock: vi.fn(async () => 300), setMock, counts, locks }
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

  // Stateful Blob store: the derivative starts absent, and a successful put
  // makes subsequent head calls succeed — so a second request for the same
  // photo is a genuine cache HIT rather than an endless waiter.
  storedDerivatives.clear()
  blobHeadMock.mockImplementation(async (pathname) => {
    if (!storedDerivatives.has(pathname)) throw new FakeBlobNotFoundError()
    return { url: DERIVATIVE_URL, size: storedDerivatives.get(pathname).length }
  })
  blobPutMock.mockImplementation(async (pathname, body) => {
    storedDerivatives.set(pathname, Buffer.from(body))
    return { url: DERIVATIVE_URL, pathname }
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
  it('missing photoId → 400, unchanged shape', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })

    const response = await callRoute({ photoId: null })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'photoId is required' })
  })

  it('no longer accepts or requires photoUrl/eventSlug at all', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma, photoFindFirst } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    // Only photoId + type are ever read from the URL — legacy params, if
    // sent anyway (e.g. a stale cached client), are simply ignored.
    const response = await callRoute({ extraParams: { photoUrl: PHOTO_URL, eventSlug: SLUG } })

    expect(response.status).toBe(200)
    expect(photoFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PHOTO_ID, status: 'VISIBLE' } })
    )
  })
})

describe('broad pre-DB guard — download-photo-broad:ip:<hashed>, 5000/10min', () => {
  it('sends a hashed IP key to Redis, never the raw IP', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    await callRoute()

    const keysUsed = evalMock.mock.calls.map((c) => c[1][0])
    expect(keysUsed[0]).toMatch(/^download-photo-broad:ip:[0-9a-f]{64}$/)
    expect(keysUsed[0]).not.toContain(IP)
  })

  it('a limited request returns the exact bare 429 and never touches DB, Blob, or Sharp', async () => {
    const { evalMock, ttlMock, setMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
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
    const { evalMock, ttlMock, setMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
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
    const { evalMock, ttlMock, setMock, counts } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
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
  it('unknown/foreign photoId → 404, no event lookup, no Blob fetch, no Sharp', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma, eventFindUnique } = makePrisma({ event: FREE_EVENT, photo: null })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute({ photoId: 'photo-does-not-exist' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Photo not found' })
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a HIDDEN photo 404s identically to a nonexistent one — never distinguishable', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma, eventFindUnique } = makePrisma({ event: FREE_EVENT, photo: null })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Photo not found' })
    expect(eventFindUnique).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the photo lookup filters on id + status VISIBLE only — no client-supplied event scoping', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma, photoFindFirst } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    await callRoute()

    expect(photoFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PHOTO_ID, status: 'VISIBLE' },
      })
    )
  })

  it('the event is derived from the found photo\'s own eventId, never from a client param', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma, eventFindUnique } = makePrisma({ event: FREE_EVENT, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    await callRoute()

    expect(eventFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EVENT_ID } })
    )
  })

  it('a photo whose event has vanished → 404, no Blob fetch, no Sharp (defensive, FK integrity notwithstanding)', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { prisma } = makePrisma({ event: null, photo: PHOTO })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('database unavailable → 503, unchanged', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(null)

    const response = await callRoute()

    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('branded response contract (Free event)', () => {
  it('returns 200 with real JPEG bytes, image/jpeg, and a .jpg filename', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
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
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.headers.get('content-type')).not.toBe('image/png')
    expect(dispositionFilename(response)).not.toMatch(/\.png$/)
  })

  it('preserves the existing Cache-Control contract', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  })
})

// Download Representation Contract v1 (PR #39): paid Standard used to be an
// untouched source passthrough (PNG in, PNG out, byte-identical). That
// passthrough contract is gone — paid Standard now resolves through the
// same shared display-v1 derivative used elsewhere, deliberately dropping
// EXIF and normalizing to a capped, re-encoded JPEG. Original quality is the
// only representation that still passes the persisted source through
// untouched (see the "paid Original — entitled" describe block below).
describe('paid Standard — display-v1 derivative (Download Representation Contract v1)', () => {
  it('serves the display-v1 JPEG derivative, not the raw source bytes', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(dispositionFilename(response)).toBe('beach.jpg')
    // display-v1, not the source PNG: the paid Standard path now enters
    // JPEG-mode processing like every other display-v1 consumer.
    expect((await sharp(body).metadata()).format).toBe('jpeg')
  })

  it('transcodes — the paid Standard body is NOT byte-identical to the source (the old passthrough contract no longer applies)', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
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

    expect(Buffer.compare(body, source)).not.toBe(0)
  })
})

// Original quality is the representation that still guarantees an untouched,
// byte-identical copy of the persisted source — proven here for a
// PAID_EVENT fixture, which is entitled (billingTier: 'pro_event' makes
// canDownloadOriginal true; see lib/event-access.js).
describe('paid Original — entitled (Download Representation Contract v1)', () => {
  it('serves the exact persisted source bytes with the source MIME type and extension', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const source = await pngSource()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    })

    const response = await callRoute({ type: 'original' })
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(PHOTO.mimeType)
    expect(dispositionFilename(response)).toBe('beach.png')
    expect(Buffer.compare(body, source)).toBe(0)
    expect((await sharp(body).metadata()).format).toBe('png')
  })

  it('never touches the display-v1 or wm-v2 derivative cache — Original is a direct source passthrough', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute({ type: 'original' })

    expect(response.status).toBe(200)
    expect(blobHeadMock).not.toHaveBeenCalled()
    expect(blobPutMock).not.toHaveBeenCalled()
  })
})

// The Download Representation Contract gates Standard on hasUnbrandedDownloads
// and Original on canDownloadOriginal independently (see
// resolveDownloadRepresentation in lib/server/download-representation.js) —
// it does not assume they're the same boolean. Today's real
// lib/event-access.js derivation happens to always couple them
// (hasUnbrandedDownloads === canDownloadOriginal), so a genuinely
// "unbranded Standard but Original still locked" event cannot be produced
// from a real Prisma-backed fixture right now; PAID_EVENT above is always
// entitled to both. This test proves the ROUTE itself preserves that
// independence end-to-end against whatever access object the resolver is
// handed, rather than silently relying on the current coupling — the same
// independence is proven at the resolver-unit level in
// tests/download-representation.test.js.
describe('Standard/Original entitlement independence at the route boundary', () => {
  it('display-v1 Standard does not imply an entitled Original', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)
    vi.doMock('@/lib/server/event-access', () => ({
      getEffectiveEventAccessState: vi.fn().mockResolvedValue({
        canDownloadOriginal: false,
        hasUnbrandedDownloads: true,
      }),
    }))

    const { GET } = await import('@/app/api/download/photo/route')

    const standard = await GET(makeRequest({ type: 'standard' }))
    expect(standard.status).toBe(200)
    expect(standard.headers.get('content-type')).toBe('image/jpeg')

    const original = await GET(makeRequest({ type: 'original' }))
    expect(original.status).toBe(403)
    expect(await original.json()).toEqual({ error: 'Original quality is not available for this event.' })

    vi.doUnmock('@/lib/server/event-access')
  })
})

describe('client cannot force branded/unbranded — server-side entitlement is the only authority', () => {
  it('type=original is forbidden on a Free (branded) event — the client cannot force original quality', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute({ type: 'original' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Original quality is not available for this event.' })
    // Forbidden before any source fetch — fails closed, not merely re-branded.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('type=standard cannot force a branded (watermarked) response on an unbranded-entitled (paid) event — it gets display-v1, not wm-v2', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute({ type: 'standard' })
    const body = Buffer.from(await response.arrayBuffer())

    // display-v1 is expected here — `type` never overrides
    // access.hasUnbrandedDownloads, but that no longer means "no derivative
    // at all"; it means "not the wm-v2 branded derivative" specifically.
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect((await sharp(body).metadata()).format).toBe('jpeg')
    expect(blobPutMock.mock.calls.map((c) => c[0])).not.toContain(DERIVATIVE_PATH)
    expect(blobPutMock.mock.calls.map((c) => c[0])).toContain(DISPLAY_DERIVATIVE_PATH)
  })
})

// ─── STEP 7.14b — derivative cache at the route level ──────────────────────

describe('branded derivative cache — route behavior', () => {
  it('a cache MISS produces the derivative once and returns the generated buffer', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(blobPutMock).toHaveBeenCalledTimes(1)
    expect(blobPutMock.mock.calls[0][0]).toBe(DERIVATIVE_PATH)
    // Source was fetched exactly once; the stored object was NOT re-read.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await sharp(body).metadata()).format).toBe('jpeg')
  })

  it('a second request for the same photo is a cache HIT: no put, no source fetch, no Sharp', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const miss = await callRoute()
    const missBody = Buffer.from(await miss.arrayBuffer())

    // Serve the stored derivative back on the follow-up read.
    const stored = storedDerivatives.get(DERIVATIVE_PATH)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength),
    })
    fetchMock.mockClear()
    blobPutMock.mockClear()

    const hit = await callRoute()
    const hitBody = Buffer.from(await hit.arrayBuffer())

    expect(blobPutMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1) // the derivative read only
    expect(fetchMock.mock.calls[0][0]).toBe(DERIVATIVE_URL)
    expect(Buffer.compare(hitBody, missBody)).toBe(0)
  })

  it('HIT and MISS are user-visible equivalent (status, type, filename, cache-control)', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    const miss = await callRoute()
    const stored = storedDerivatives.get(DERIVATIVE_PATH)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength),
    })
    const hit = await callRoute()

    expect(hit.status).toBe(miss.status)
    expect(hit.status).toBe(200)
    expect(hit.headers.get('content-type')).toBe(miss.headers.get('content-type'))
    expect(hit.headers.get('content-type')).toBe('image/jpeg')
    expect(dispositionFilename(hit)).toBe(dispositionFilename(miss))
    expect(dispositionFilename(hit)).toBe('beach.jpg')
    expect(hit.headers.get('cache-control')).toBe(miss.headers.get('cache-control'))
    expect(hit.headers.get('cache-control')).toBe('private, max-age=300')
  })

  it('a degraded derivative store returns a temporary 503 and never transforms', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)
    blobHeadMock.mockRejectedValue(new Error('blob service unavailable'))

    const response = await callRoute()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Download is temporarily unavailable. Please try again.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(blobPutMock).not.toHaveBeenCalled()
  })

  it('a waiter that exhausts its deadline returns the preparing 503 without transforming', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)

    // The waiter loop's own timing is proven with an injected clock in
    // tests/download-photo-derivative.test.js; here we only assert the
    // route's mapping of that outcome, so no real 10s wait is needed.
    const actual = await import('@/lib/server/download-derivative')
    vi.doMock('@/lib/server/download-derivative', () => ({
      ...actual,
      getBrandedDerivative: vi.fn().mockRejectedValue(new actual.DerivativePendingError()),
    }))

    const { GET } = await import('@/app/api/download/photo/route')
    const response = await GET(makeRequest())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Download is being prepared. Please try again.' })
    expect(response.headers.get('Retry-After')).toBeNull()
    expect(blobPutMock).not.toHaveBeenCalled()
    vi.doUnmock('@/lib/server/download-derivative')
  })

  it('the paid Standard (display-v1) path never touches the wm-v2 branded derivative cache namespace', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)

    const response = await callRoute()

    expect(response.status).toBe(200)
    // No wm-v2 branded activity at all...
    expect(blobHeadMock).not.toHaveBeenCalledWith(DERIVATIVE_PATH)
    expect(blobPutMock.mock.calls.map((c) => c[0])).not.toContain(DERIVATIVE_PATH)
    expect(setMock).not.toHaveBeenCalledWith(expect.stringContaining('download-photo-transform'), expect.anything(), expect.anything())
    // ...but display-v1 IS a real derivative cache namespace now — it costs
    // a Blob head/put and its own distributed lock, same as wm-v2 does.
    expect(blobHeadMock).toHaveBeenCalledWith(DISPLAY_DERIVATIVE_PATH)
    expect(blobPutMock.mock.calls.map((c) => c[0])).toContain(DISPLAY_DERIVATIVE_PATH)
    expect(setMock).toHaveBeenCalledWith(DISPLAY_TRANSFORM_LOCK_KEY, expect.anything(), expect.anything())
  })

  it('a hidden photo 404s without any derivative lookup', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: null }).prisma)

    const response = await callRoute()

    expect(response.status).toBe(404)
    expect(blobHeadMock).not.toHaveBeenCalled()
    expect(blobPutMock).not.toHaveBeenCalled()
  })

  it('after an entitlement flip to unbranded, the branded (wm-v2) derivative is not reused/consulted — display-v1 is produced in its own cache namespace', async () => {
    const { evalMock, ttlMock, setMock } = installHealthyRedisMock()
    await setupRedis({ eval: evalMock, ttl: ttlMock, set: setMock })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')

    // Free first: the wm-v2 branded derivative gets created.
    getPrismaClient.mockResolvedValue(makePrisma({ event: FREE_EVENT, photo: PHOTO }).prisma)
    await callRoute()
    expect(storedDerivatives.has(DERIVATIVE_PATH)).toBe(true)
    expect(storedDerivatives.has(DISPLAY_DERIVATIVE_PATH)).toBe(false)

    // Now unlocked/paid: same photo must take the display-v1 path — never
    // re-reading the already-cached wm-v2 branded object.
    blobHeadMock.mockClear()
    getPrismaClient.mockResolvedValue(makePrisma({ event: PAID_EVENT, photo: PHOTO }).prisma)
    const response = await callRoute()
    const body = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(dispositionFilename(response)).toBe('beach.jpg')
    expect((await sharp(body).metadata()).format).toBe('jpeg')
    // The wm-v2 branded object is never re-consulted even though it already
    // exists from the Free request above...
    expect(blobHeadMock).not.toHaveBeenCalledWith(DERIVATIVE_PATH)
    // ...but display-v1's own cache namespace IS consulted/produced fresh.
    expect(blobHeadMock).toHaveBeenCalledWith(DISPLAY_DERIVATIVE_PATH)
    expect(storedDerivatives.has(DISPLAY_DERIVATIVE_PATH)).toBe(true)
  })
})

describe('route duration contract', () => {
  it('declares maxDuration = 20, the bound the 25s lock TTL is derived from', async () => {
    const mod = await import('@/app/api/download/photo/route')
    expect(mod.maxDuration).toBe(20)
  })
})
