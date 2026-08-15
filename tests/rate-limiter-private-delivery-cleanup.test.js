import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// STEP 7.9b — removes the legacy, always-in-memory, cross-flow-colliding
// rateLimit(`upload-init:ip:...`) / rateLimit(`upload-complete:ip:...`) calls
// from initPrivateDeliveryUpload / completePrivateDeliveryUpload. The
// already-Redis-backed checkOwnerRateLimit(...privateDeliveryWrite...) —
// unchanged by this STEP — remains the sole rate limiter for both handlers.
// See STEP 7.9a.2 §E for the full double-limiting/cross-flow-key-collision
// finding this cleanup resolves.

const ROOT = resolve(import.meta.dirname, '..')
const ROUTE_SOURCE = readFileSync(resolve(ROOT, 'app/api/[[...path]]/route.js'), 'utf8')

function extractFunctionBody(source, startMarker) {
  const startIdx = source.indexOf(startMarker)
  if (startIdx === -1) throw new Error(`marker not found: ${startMarker}`)
  // Both functions end at the first top-level "\n}\n\n" after their start —
  // matching the existing repo convention for anchored-window extraction.
  const endIdx = source.indexOf('\n}\n', startIdx)
  return source.slice(startIdx, endIdx)
}

const INIT_BODY = extractFunctionBody(ROUTE_SOURCE, 'const initPrivateDeliveryUpload = async (request, slug) => {')
const COMPLETE_BODY = extractFunctionBody(ROUTE_SOURCE, 'const completePrivateDeliveryUpload = async (request, slug) => {')

// ─── 1/9. Structural: sole owner limiter, legacy IP layer gone ─────────────

describe('1/9 — structural: checkOwnerRateLimit is the sole rate limiter in both handlers', () => {
  it('initPrivateDeliveryUpload still calls checkOwnerRateLimit(...privateDeliveryWrite...)', () => {
    expect(INIT_BODY).toContain('checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.privateDeliveryWrite)')
  })

  it('completePrivateDeliveryUpload still calls checkOwnerRateLimit(...privateDeliveryWrite...)', () => {
    expect(COMPLETE_BODY).toContain('checkOwnerRateLimit(request, ownerEmail, OWNER_WRITE_LIMITS.privateDeliveryWrite)')
  })

  it('initPrivateDeliveryUpload no longer contains the legacy upload-init:ip rateLimit call', () => {
    expect(INIT_BODY).not.toContain('upload-init:ip:')
    expect(INIT_BODY).not.toMatch(/\brateLimit\(/)
  })

  it('completePrivateDeliveryUpload no longer contains the legacy upload-complete:ip rateLimit call', () => {
    expect(COMPLETE_BODY).not.toContain('upload-complete:ip:')
    expect(COMPLETE_BODY).not.toMatch(/\brateLimit\(/)
  })
})

// ─── Route-level behavior tests ────────────────────────────────────────────

vi.mock('@/lib/server/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, checkRateLimit: vi.fn(actual.checkRateLimit), rateLimit: vi.fn(actual.rateLimit) }
})

vi.mock('@/lib/server/event-access', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getEffectiveEventAccessState: vi.fn() }
})

vi.mock('@/lib/server/blob-upload-init', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createServerBoundBlobUploadInit: vi.fn() }
})

vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getStorageDriver: vi.fn().mockReturnValue({ mode: 'vercel-blob' }) }
})

vi.mock('@/lib/server/entitlements', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, checkPrivateDeliveryEntitlement: vi.fn() }
})

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeEvent(overrides = {}) {
  return { id: EVENT_ID, slug: SLUG, ownerEmail: OWNER_EMAIL, billingTier: null, ...overrides }
}

async function buildOwnerRequest(body) {
  const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
  const { createCsrfToken } = await import('@/lib/server/csrf')
  const cookieValue = await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: 0 })
  const csrfToken = createCsrfToken(OWNER_EMAIL)
  return {
    method: 'POST',
    headers: {
      get: (name) => {
        if (name === 'origin') return ALLOWED_ORIGIN
        if (name === 'x-csrf-token') return csrfToken
        return null
      },
    },
    cookies: { get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
    json: async () => body,
  }
}

function makeFakePrisma() {
  return {
    owner: {
      async findUnique({ where }) {
        if (where.email === OWNER_EMAIL) return { id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }
        return null
      },
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.CSRF_SECRET = 'test-csrf-secret'
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN
  process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token'
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

afterEach(() => {
  restoreEnv()
})

// ─── 10. Owner limit exceeded → unchanged 429 contract ─────────────────────

describe('10 — owner rate limit exceeded: 429 contract identical to pre-STEP-7.9b behavior', () => {
  it('init: checkRateLimit reporting limited produces the existing buildRateLimitResponse shape', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: true, retryAfter: 37, backend: 'redis', degraded: false, backendError: false })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: 37 })
    expect(response.headers.get('Retry-After')).toBe('37')
  })

  it('complete: checkRateLimit reporting limited produces the existing buildRateLimitResponse shape', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: true, retryAfter: 51, backend: 'redis', degraded: false, backendError: false })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toEqual({ error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: 51 })
    expect(response.headers.get('Retry-After')).toBe('51')
  })
})

// ─── 11. Under limit → normal business path reached, legacy limiter never called ──

describe('11 — under limit: normal flow is reached and the legacy per-IP limiter is never invoked', () => {
  it('init: proceeds to session creation (201) with zero calls to the legacy rateLimit()', async () => {
    const { checkRateLimit, rateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: false, backend: 'redis', degraded: false, backendError: false })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })
    const { getEffectiveEventAccessState } = await import('@/lib/server/event-access')
    getEffectiveEventAccessState.mockResolvedValue({ hasPrivateDelivery: true })
    const { createServerBoundBlobUploadInit } = await import('@/lib/server/blob-upload-init')
    createServerBoundBlobUploadInit.mockResolvedValue({ sessionId: 'session-1', pathname: 'private-delivery/x.jpg' })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.session.sessionId).toBe('session-1')
    expect(checkRateLimit).toHaveBeenCalledTimes(1)
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('complete: proceeds to the completion library (unaffected by the cleanup) with zero calls to the legacy rateLimit()', async () => {
    const { BlobUploadKind, BlobUploadSessionStatus } = await import('@prisma/client')
    const { checkRateLimit, rateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: false, backend: 'redis', degraded: false, backendError: false })

    const BLOB_URL = 'https://abc123.public.blob.vercel-storage.com/private-delivery/wedding-2026/album.zip'
    const session = {
      id: 'session-1',
      eventId: EVENT_ID,
      eventSlug: SLUG,
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      status: BlobUploadSessionStatus.UPLOADED,
      expectedPathname: 'private-delivery/wedding-2026/album.zip',
      originalName: 'album.zip',
      mimeType: 'application/zip',
      expectedSize: 2048,
      uploaderName: null,
      caption: null,
      momentId: null,
      blobUrl: BLOB_URL,
      resultId: null,
      tokenIssuedAt: new Date(),
      uploadedAt: new Date(),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      cleanupAttempts: 0,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const sessionsStore = new Map([[session.id, { ...session }]])
    const eventsStore = new Map([[EVENT_ID, makeEvent()]])
    const assetsStore = new Map()
    let assetCounter = 1

    const prisma = {
      blobUploadSession: {
        async findUnique({ where }) {
          const r = sessionsStore.get(where.id)
          return r ? { ...r } : null
        },
        async updateMany({ where, data }) {
          let count = 0
          for (const [, r] of sessionsStore) {
            if (r.id === where.id || r.status === where.status) {
              Object.assign(r, data)
              count++
            }
          }
          return { count }
        },
      },
      event: {
        async findUnique({ where }) {
          const r = eventsStore.get(where.id)
          return r ? { ...r } : null
        },
        async update({ where, data }) {
          const r = eventsStore.get(where.id)
          if (!r) {
            const err = new Error('Record not found')
            err.code = 'P2025'
            throw err
          }
          Object.assign(r, data)
          return { ...r }
        },
      },
      privateAsset: {
        async create({ data }) {
          const id = `asset-${assetCounter++}`
          const r = { id, ...data }
          assetsStore.set(id, r)
          return { ...r }
        },
      },
      owner: makeFakePrisma().owner,
      async $transaction(fn) {
        return fn({
          blobUploadSession: this.blobUploadSession,
          event: this.event,
          privateAsset: this.privateAsset,
        })
      },
    }

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })
    const { head } = await import('@vercel/blob')
    head.mockResolvedValue({ url: BLOB_URL, pathname: session.expectedPathname, size: 2048, contentType: 'application/zip' })
    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    checkPrivateDeliveryEntitlement.mockResolvedValue({ allowed: true, upgradePath: null })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.asset).toBeDefined()
    expect(checkRateLimit).toHaveBeenCalledTimes(1)
    expect(rateLimit).not.toHaveBeenCalled()
  })
})

// ─── 12. Redis backend failure semantics — unchanged, no 503 introduced ────

describe('12 — Redis backend failure: checkOwnerRateLimit semantics unchanged (no backendError fail-closed check exists here)', () => {
  it('backendError true but not limited (memory fallback under its own limit) → request proceeds, NOT 503', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: false, backend: 'memory', degraded: true, backendError: true })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })
    const { getEffectiveEventAccessState } = await import('@/lib/server/event-access')
    getEffectiveEventAccessState.mockResolvedValue({ hasPrivateDelivery: true })
    const { createServerBoundBlobUploadInit } = await import('@/lib/server/blob-upload-init')
    createServerBoundBlobUploadInit.mockResolvedValue({ sessionId: 'session-1' })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })

    expect(response.status).not.toBe(503)
    expect(response.status).toBe(201)
  })

  it('backendError true AND memory fallback itself limited → existing 429 semantics apply, NOT 503', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    checkRateLimit.mockResolvedValue({ limited: true, retryAfter: 12, backend: 'memory', degraded: true, backendError: true })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()) })

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(response.status).not.toBe(503)
    expect(body).toEqual({ error: 'Too many requests. Please try again later.', code: 'rate_limited', retryAfter: 12 })
  })
})

// ─── 13. Auth/CSRF regression — unrelated to this cleanup, still enforced first ──

describe('13 — auth/CSRF regression: unchanged, still enforced before rate limiting', () => {
  it('missing owner session → 401, checkRateLimit never called', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = {
      method: 'POST',
      headers: { get: (name) => (name === 'origin' ? ALLOWED_ORIGIN : null) },
      cookies: { get: () => undefined },
      json: async () => ({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
    }
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })

    expect(response.status).toBe(401)
    expect(checkRateLimit).not.toHaveBeenCalled()
  })

  it('valid session but missing/invalid CSRF token → 403, checkRateLimit never called', async () => {
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    const { createOwnerSessionToken, OWNER_COOKIE_NAME } = await import('@/lib/server/owner-auth')
    const cookieValue = await createOwnerSessionToken({ email: OWNER_EMAIL, sessionVersion: 0 })

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = {
      method: 'POST',
      headers: { get: (name) => (name === 'origin' ? ALLOWED_ORIGIN : null) },
      cookies: { get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined) },
      json: async () => ({ eventSlug: SLUG, fileName: 'a.jpg', fileSize: 100, mimeType: 'image/jpeg', totalChunks: 1 }),
    }
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'init'] } })

    expect(response.status).toBe(403)
    expect(checkRateLimit).not.toHaveBeenCalled()
  })
})
