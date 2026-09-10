import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression coverage for the cover-upload orphan finding: uploadEventCover
// calls put() (Vercel Blob) and then persists the URL via
// repository.updateEvent(). If updateEvent() fails, the just-written blob has
// no BlobUploadSession and is therefore invisible to the cleanup cron —
// without a compensating cleanup it would be a permanent orphan. The fix
// wraps only the persistence step in try/catch and deletes the newly created
// blob on failure, while rethrowing the original error unchanged.

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}))

vi.mock('@/lib/server/storage', () => ({
  deleteStoredFile: vi.fn().mockResolvedValue(undefined),
}))

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
const NEW_BLOB_URL = 'https://abc123.public.blob.vercel-storage.com/covers/wedding-2026/1700000000000-cover.webp'
const OLD_COVER_URL = 'https://abc123.public.blob.vercel-storage.com/covers/wedding-2026/old-cover.jpg'

// A 1x1 transparent PNG data URL — small, valid, decodes to a real buffer.
const COVER_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

async function buildOwnerRequest({ body }) {
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
    cookies: {
      get: (name) => (name === OWNER_COOKIE_NAME ? { value: cookieValue } : undefined),
    },
    json: async () => body ?? {},
  }
}

function makeEvent(overrides = {}) {
  return { id: 'event-1', slug: SLUG, ownerEmail: OWNER_EMAIL, coverUrl: null, ...overrides }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.OWNER_SESSION_SECRET = 'test-owner-secret-'.repeat(3)
  process.env.CSRF_SECRET = 'test-csrf-secret'
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN

  const { getPrismaClient } = await import('@/lib/server/prisma-client')
  getPrismaClient.mockResolvedValue({
    owner: { findUnique: vi.fn().mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, sessionVersion: 0 }) },
  })

  const { put } = await import('@vercel/blob')
  put.mockResolvedValue({ url: NEW_BLOB_URL, pathname: 'covers/wedding-2026/1700000000000-cover.webp' })
})

afterEach(() => {
  restoreEnv()
})

async function callUploadCover(event, body = { coverDataUrl: COVER_DATA_URL }) {
  const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
  const updateEvent = vi.fn().mockResolvedValue({ ...event, coverUrl: NEW_BLOB_URL })
  const getEventBySlugAndOwner = vi.fn().mockResolvedValue(event)
  getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner, updateEvent })

  const { POST } = await import('@/app/api/[[...path]]/route')
  const request = await buildOwnerRequest({ body })
  const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })
  return { response, updateEvent, getEventBySlugAndOwner }
}

// ─── A. put() succeeds, updateEvent() fails ──

describe('A — put() succeeds, updateEvent() fails', () => {
  it('deletes exactly the new blob, does not touch any old cover, and propagates the original error', async () => {
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const dbError = new Error('connection reset')
    const updateEvent = vi.fn().mockRejectedValue(dbError)
    const getEventBySlugAndOwner = vi.fn().mockResolvedValue(makeEvent({ coverUrl: null }))
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner, updateEvent })

    const { deleteStoredFile } = await import('@/lib/server/storage')
    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ body: { coverDataUrl: COVER_DATA_URL } })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    const body = await response.json()

    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(NEW_BLOB_URL)
    // The original updateEvent error is what the outer handler ends up
    // reporting — same generic message/status as before this fix.
    expect(response.status).toBe(500)
    expect(body.error).toBe('Unable to save cover image. Please try again.')
  })
})

// ─── B. put() succeeds, updateEvent() succeeds ──

describe('B — put() succeeds, updateEvent() succeeds', () => {
  it('does not invoke compensating cleanup and returns the updated event', async () => {
    const { deleteStoredFile } = await import('@/lib/server/storage')
    const { response } = await callUploadCover(makeEvent({ coverUrl: null }))
    const body = await response.json()

    expect(deleteStoredFile).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(body.event.coverUrl).toBe(NEW_BLOB_URL)
  })
})

// ─── C. updateEvent fails AND cleanup of the new blob also fails ──

describe('C — updateEvent fails and the compensating cleanup also fails', () => {
  it('still surfaces the original updateEvent error; the cleanup error is only logged', async () => {
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const dbError = new Error('connection reset')
    const updateEvent = vi.fn().mockRejectedValue(dbError)
    const getEventBySlugAndOwner = vi.fn().mockResolvedValue(makeEvent({ coverUrl: null }))
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner, updateEvent })

    const { deleteStoredFile } = await import('@/lib/server/storage')
    deleteStoredFile.mockRejectedValue(new Error('blob delete failed'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ body: { coverDataUrl: COVER_DATA_URL } })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Unable to save cover image. Please try again.')
    expect(
      errorSpy.mock.calls.some((call) => call[0] === '[uploadEventCover] Compensating cleanup failed after updateEvent error'),
    ).toBe(true)

    errorSpy.mockRestore()
  })
})

// ─── D. put() fails ──

describe('D — put() fails', () => {
  it('attempts no cleanup and never calls updateEvent', async () => {
    const { put } = await import('@vercel/blob')
    put.mockRejectedValue(new Error('blob service unavailable'))

    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const updateEvent = vi.fn()
    const getEventBySlugAndOwner = vi.fn().mockResolvedValue(makeEvent({ coverUrl: null }))
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner, updateEvent })

    const { deleteStoredFile } = await import('@/lib/server/storage')
    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ body: { coverDataUrl: COVER_DATA_URL } })
    const response = await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    expect(response.status).toBe(500)
    expect(updateEvent).not.toHaveBeenCalled()
    expect(deleteStoredFile).not.toHaveBeenCalled()
  })
})

// ─── E. existing cover + success: old-cover cleanup behavior unchanged ──

describe('E — event with an existing cover, upload succeeds', () => {
  it('still deletes the old cover via the existing deleteManagedEventCover path', async () => {
    const { deleteStoredFile } = await import('@/lib/server/storage')
    await callUploadCover(makeEvent({ coverUrl: OLD_COVER_URL }))

    expect(deleteStoredFile).toHaveBeenCalledWith(OLD_COVER_URL)
  })
})

// ─── F. existing cover + updateEvent fails: old cover must NOT be touched ──

describe('F — event with an existing cover, updateEvent fails', () => {
  it('never calls deleteManagedEventCover / deleteStoredFile for the old cover', async () => {
    const { getGalleryRepository } = await import('@/lib/server/gallery-repository')
    const updateEvent = vi.fn().mockRejectedValue(new Error('connection reset'))
    const getEventBySlugAndOwner = vi.fn().mockResolvedValue(makeEvent({ coverUrl: OLD_COVER_URL }))
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner, updateEvent })

    const { deleteStoredFile } = await import('@/lib/server/storage')
    const { POST } = await import('@/app/api/[[...path]]/route')
    const request = await buildOwnerRequest({ body: { coverDataUrl: COVER_DATA_URL } })
    await POST(request, { params: { path: ['owner', 'events', SLUG, 'cover'] } })

    // Only the new blob is deleted (compensating cleanup) — the old cover
    // URL must never appear in any deleteStoredFile call.
    expect(deleteStoredFile).toHaveBeenCalledTimes(1)
    expect(deleteStoredFile).toHaveBeenCalledWith(NEW_BLOB_URL)
    expect(deleteStoredFile).not.toHaveBeenCalledWith(OLD_COVER_URL)
  })
})

// ─── G. PII minimization regression — TASK-01 ──
//
// uploadEventCover used to run a second, redundant rate-limit check keyed
// by raw ownerEmail/clientIp through the deprecated in-memory rateLimit()
// helper, on top of the already-correct, hashed checkOwnerRateLimit() call
// above it. That redundant block is now removed. These tests lock in both
// halves of the fix: (1) the deprecated raw-keyed limiter is never invoked
// by this route any more, and (2) owner-scoped rate limiting still actually
// works via the remaining, correctly-hashed path — the fix must not have
// silently dropped the protection along with the raw key.

describe('G — PII minimization: cover-upload rate limiting', () => {
  it('never calls the deprecated raw-keyed rateLimit() helper', async () => {
    const rateLimiter = await import('@/lib/server/rate-limiter')
    const rateLimitSpy = vi.spyOn(rateLimiter, 'rateLimit')

    await callUploadCover(makeEvent({ coverUrl: null }))

    expect(rateLimitSpy).not.toHaveBeenCalled()
    rateLimitSpy.mockRestore()
  })

  it('still enforces the owner-scoped cover-upload limit via the hashed checkOwnerRateLimit path', async () => {
    const { OWNER_WRITE_LIMITS } = await import('@/lib/server/rate-limiter')
    const maxRequests = OWNER_WRITE_LIMITS.coverUpload.owner.max

    let lastResponse
    for (let i = 0; i < maxRequests + 1; i += 1) {
      const { response } = await callUploadCover(makeEvent({ coverUrl: null }))
      lastResponse = response
    }

    expect(lastResponse.status).toBe(429)
  })
})
