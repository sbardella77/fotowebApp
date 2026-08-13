import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import { hashPhotographerUploadToken, generatePhotographerUploadToken } from '@/lib/server/photographer-token'

// Regression coverage for the MEDIUM finding: completePrivateDeliveryUpload
// and completePhotographerUpload used to run their own route-level
// hasPrivateDelivery check BEFORE calling completePrivateAssetBlobUpload().
// If that route-level check was the one to fail, the library's transaction
// (and its safeCleanup()) was never reached, leaving an already-uploaded
// blob to wait for the cron. The check has been removed from the Vercel
// Blob path in both handlers — entitlement is now enforced exclusively
// inside the library, whose safeCleanup() must be observed to run here.
//
// These tests exercise the REAL completion library (not mocked) through the
// real HTTP handlers, only mocking checkPrivateDeliveryEntitlement (to force
// a "revoked after init" outcome deterministically) and the storage/Prisma
// boundaries.

vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    deleteStoredFile: vi.fn().mockResolvedValue(undefined),
    getStorageDriver: vi.fn().mockReturnValue({ mode: 'vercel-blob' }),
  }
})

vi.mock('@/lib/server/entitlements', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    checkPrivateDeliveryEntitlement: vi.fn(),
  }
})

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn(),
}))

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const ALLOWED_ORIGIN = 'https://snaprooms.app'
const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'
const EXPECTED_PATHNAME = `private-delivery/${SLUG}/uuid-album.zip`
const BLOB_URL = `https://abc123.public.blob.vercel-storage.com/${EXPECTED_PATHNAME}`

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

// ─── Minimal fake Prisma — only the delegates these flows touch ─────────────

function matchesWhere(record, where) {
  for (const [key, condition] of Object.entries(where)) {
    const val = record[key]
    if (condition === null) {
      if (val !== null && val !== undefined) return false
      continue
    }
    if (typeof condition === 'object' && condition !== null) {
      if ('not' in condition) {
        if (val === condition.not) return false
      } else if ('gt' in condition) {
        if (!(val > condition.gt)) return false
      } else if ('in' in condition) {
        if (!condition.in.includes(val)) return false
      }
    } else if (val !== condition) {
      return false
    }
  }
  return true
}

function applyData(record, data) {
  for (const [key, value] of Object.entries(data)) {
    record[key] = value
  }
}

function makeFakePrisma({ sessions = [], events = [], privateAssets = [] } = {}) {
  const sessionsStore = new Map(sessions.map((s) => [s.id, { ...s }]))
  const eventsStore = new Map(events.map((e) => [e.id, { ...e }]))
  const assetsStore = new Map(privateAssets.map((a) => [a.id, { ...a }]))
  let assetCounter = 1

  const makeSessionDelegate = () => ({
    async findUnique({ where }) {
      const r = sessionsStore.get(where.id)
      return r ? { ...r } : null
    },
    async updateMany({ where, data }) {
      let count = 0
      for (const [, r] of sessionsStore) {
        if (matchesWhere(r, where)) {
          applyData(r, data)
          count++
        }
      }
      return { count }
    },
  })

  const makeEventDelegate = () => ({
    async update({ where, data }) {
      const r = eventsStore.get(where.id)
      if (!r) {
        const err = new Error('Record not found')
        err.code = 'P2025'
        throw err
      }
      applyData(r, data)
      return { ...r }
    },
    async findUnique({ where }) {
      const r = eventsStore.get(where.id)
      return r ? { ...r } : null
    },
    async findFirst({ where }) {
      for (const [, r] of eventsStore) {
        if (matchesWhere(r, where)) return { ...r }
      }
      return null
    },
  })

  const makeAssetDelegate = () => ({
    async findUnique({ where }) {
      const r = assetsStore.get(where.id)
      return r ? { ...r } : null
    },
    async create({ data }) {
      const id = `asset-${assetCounter++}`
      const r = { id, ...data }
      assetsStore.set(id, { ...r })
      return { ...r }
    },
  })

  const $transaction = async (fn) => {
    const tx = {
      blobUploadSession: makeSessionDelegate(),
      event: makeEventDelegate(),
      privateAsset: makeAssetDelegate(),
    }
    return fn(tx)
  }

  return {
    blobUploadSession: makeSessionDelegate(),
    event: makeEventDelegate(),
    privateAsset: makeAssetDelegate(),
    // Needed for verifyOwnerSessionToken's sessionVersion round-trip.
    owner: {
      async findUnique({ where }) {
        if (where.email === OWNER_EMAIL) {
          return { id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }
        }
        return null
      },
    },
    $transaction,
    _sessions: sessionsStore,
    _assets: assetsStore,
  }
}

function makeSession(overrides = {}) {
  return {
    id: 'session-1',
    eventId: EVENT_ID,
    eventSlug: SLUG,
    uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
    status: BlobUploadSessionStatus.UPLOADED,
    expectedPathname: EXPECTED_PATHNAME,
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
    ...overrides,
  }
}

function makeEvent(overrides = {}) {
  return { id: EVENT_ID, slug: SLUG, ownerEmail: OWNER_EMAIL, billingTier: null, ...overrides }
}

function makeHeadResult(overrides = {}) {
  return {
    url: BLOB_URL,
    pathname: EXPECTED_PATHNAME,
    size: 2048,
    contentType: 'application/zip',
    ...overrides,
  }
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

function buildPhotographerRequest(body) {
  return {
    method: 'POST',
    headers: { get: () => null },
    cookies: { get: () => undefined },
    json: async () => body,
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
})

afterEach(() => {
  restoreEnv()
})

// ─── 11. Private delivery: entitlement revoked after init → library reached, safeCleanup runs ──

describe('11 — POST /owner/events/:slug/private-delivery/complete: entitlement revoked after init', () => {
  it('reaches the completion library, rejects with private_delivery_unavailable, and deletes the orphaned blob', async () => {
    const prisma = makeFakePrisma({ sessions: [makeSession()], events: [makeEvent()] })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()),
    })

    const { head } = await import('@vercel/blob')
    head.mockResolvedValue(makeHeadResult())

    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    checkPrivateDeliveryEntitlement.mockResolvedValue({ allowed: false, upgradePath: 'wedding_pro' })

    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('private_delivery_unavailable')
    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(BLOB_URL)

    // The session must no longer be sitting UPLOADED waiting for the cron —
    // safeCleanup has already transitioned it out of the eligible set.
    const finalSession = prisma._sessions.get('session-1')
    expect(finalSession.status).toBe(BlobUploadSessionStatus.REJECTED)
  })
})

// ─── 12. Photographer: entitlement revoked after init, token still valid ──

describe('12 — POST /photographer-upload/:token/complete: entitlement revoked after init', () => {
  it('reaches the completion library, rejects with private_delivery_unavailable, and deletes the orphaned blob', async () => {
    const photographerToken = generatePhotographerUploadToken()
    const event = makeEvent({
      photographerUploadTokenHash: hashPhotographerUploadToken(photographerToken),
      photographerUploadTokenExpiresAt: new Date(Date.now() + 3_600_000),
    })
    const session = makeSession({ uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD })
    const prisma = makeFakePrisma({ sessions: [session], events: [event] })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({})

    const { head } = await import('@vercel/blob')
    head.mockResolvedValue(makeHeadResult())

    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    checkPrivateDeliveryEntitlement.mockResolvedValue({ allowed: false, upgradePath: 'wedding_pro' })

    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = buildPhotographerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['photographer-upload', photographerToken, 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('private_delivery_unavailable')
    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(BLOB_URL)
  })
})

// ─── 13a. Entitlement valid → completion normal, unchanged ──

describe('13a — entitlement valid: normal completion is unaffected', () => {
  it('private delivery completes successfully and never calls deleteStoredFile', async () => {
    const prisma = makeFakePrisma({ sessions: [makeSession()], events: [makeEvent()] })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()),
    })

    const { head } = await import('@vercel/blob')
    head.mockResolvedValue(makeHeadResult())

    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    checkPrivateDeliveryEntitlement.mockResolvedValue({ allowed: true, upgradePath: null })

    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.asset).toBeDefined()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── 13b. Owner not the room owner → unchanged (404 before reaching entitlement/library) ──

describe('13b — owner does not own the room', () => {
  it('returns 404 without calling checkPrivateDeliveryEntitlement or the completion library', async () => {
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(null),
    })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma())

    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })

    expect(response.status).toBe(404)
    expect(checkPrivateDeliveryEntitlement).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── 13c. Photographer token invalid/expired → 403 before the library, unchanged ──

describe('13c — invalid photographer token', () => {
  it('returns 403 "Invalid or expired link" without calling head(), entitlement, or deleteStoredFile', async () => {
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(makeFakePrisma({ events: [] })) // no event matches any token hash

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({})

    const { head } = await import('@vercel/blob')
    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = buildPhotographerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['photographer-upload', 'not-a-real-token', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe('Invalid or expired link')
    expect(head).not.toHaveBeenCalled()
    expect(checkPrivateDeliveryEntitlement).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── 13d. Event/session mismatch → no improper cleanup ──

describe('13d — session belongs to a different event', () => {
  it('rejects with session_event_mismatch and never calls deleteStoredFile', async () => {
    const otherEventSession = makeSession({ eventId: 'event-OTHER', eventSlug: 'other-room' })
    const prisma = makeFakePrisma({ sessions: [otherEventSession], events: [makeEvent()] })
    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    getPrismaClient.mockResolvedValue(prisma)

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(makeEvent()),
    })

    const { checkPrivateDeliveryEntitlement } = await import('@/lib/server/entitlements')
    checkPrivateDeliveryEntitlement.mockResolvedValue({ allowed: true, upgradePath: null })

    const { deleteStoredFile } = await import('@/lib/server/storage')

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ sessionId: 'session-1' })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'private-delivery', 'complete'] } })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('session_event_mismatch')
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})
