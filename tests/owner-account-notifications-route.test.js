import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@vercel/blob', () => ({
  head: vi.fn(),
  BlobError: class BlobError extends Error {},
}))

vi.mock('@/lib/server/derivative-cleanup', () => ({
  deletePhotoDerivatives: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
  deletePhotoDerivativesBatch: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
}))

vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deleteStoredFile: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))

vi.mock('@/lib/server/management-token', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, verifyManagementToken: vi.fn().mockReturnValue(true) }
})

vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository: vi.fn(),
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const { verifyOwnerSessionToken } = vi.hoisted(() => ({ verifyOwnerSessionToken: vi.fn() }))
vi.mock('@/lib/server/owner-auth', () => ({
  OWNER_COOKIE_NAME: 'snaprooms_owner_session',
  verifyOwnerSessionToken,
}))

const { requireCsrfProtection, verifySameOriginRequest } = vi.hoisted(() => ({
  requireCsrfProtection: vi.fn(),
  verifySameOriginRequest: vi.fn(),
}))
vi.mock('@/lib/server/csrf', () => ({ requireCsrfProtection, verifySameOriginRequest }))

const { resolveCanonicalOwner } = vi.hoisted(() => ({ resolveCanonicalOwner: vi.fn() }))
vi.mock('@/lib/server/owner-resolution', () => ({ resolveCanonicalOwner }))

import { GET, PATCH } from '@/app/api/[[...path]]/route'

const PARAMS = { params: { path: ['owner', 'account', 'notifications'] } }
const OWNER_EMAIL = 'owner@example.com'

function createRequest({ method = 'GET', body, cookie = 'session-token' } = {}) {
  return {
    method,
    cookies: {
      get: vi.fn((name) => (name === 'snaprooms_owner_session' && cookie ? { value: cookie } : undefined)),
    },
    headers: {
      get: vi.fn(() => null),
    },
    json: vi.fn().mockResolvedValue(body ?? {}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifySameOriginRequest.mockReturnValue({ allowed: true })
  requireCsrfProtection.mockReturnValue({ success: true })
})

describe('GET /api/owner/account/notifications', () => {
  it('requires owner authentication', async () => {
    verifyOwnerSessionToken.mockResolvedValue(null)

    const response = await GET(createRequest({ cookie: null }), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Owner authentication required')
  })

  it('returns the current preference for an authenticated owner', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    resolveCanonicalOwner.mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, emailNotificationsEnabled: false })

    const response = await GET(createRequest(), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.emailNotificationsEnabled).toBe(false)
  })

  it('returns 404 when the owner cannot be resolved', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    resolveCanonicalOwner.mockResolvedValue(null)

    const response = await GET(createRequest(), PARAMS)
    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/owner/account/notifications', () => {
  it('requires owner authentication', async () => {
    verifyOwnerSessionToken.mockResolvedValue(null)

    const response = await PATCH(createRequest({ method: 'PATCH', cookie: null, body: { enabled: false } }), PARAMS)
    expect(response.status).toBe(401)
  })

  it('rejects a failed CSRF check', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    requireCsrfProtection.mockReturnValue({ success: false, status: 403, code: 'csrf_missing', message: 'Security check failed.' })

    const response = await PATCH(createRequest({ method: 'PATCH', body: { enabled: false } }), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('csrf_missing')
  })

  it('rejects a non-boolean "enabled" value', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)

    const response = await PATCH(createRequest({ method: 'PATCH', body: { enabled: 'nope' } }), PARAMS)
    expect(response.status).toBe(400)
  })

  it('returns 404 when the owner cannot be resolved', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    resolveCanonicalOwner.mockResolvedValue(null)

    const response = await PATCH(createRequest({ method: 'PATCH', body: { enabled: false } }), PARAMS)
    expect(response.status).toBe(404)
  })

  it('updates and returns the new preference', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    resolveCanonicalOwner.mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, emailNotificationsEnabled: true })
    const update = vi.fn().mockResolvedValue({ emailNotificationsEnabled: false })
    getPrismaClient.mockResolvedValue({ owner: { update } })

    const response = await PATCH(createRequest({ method: 'PATCH', body: { enabled: false } }), PARAMS)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.emailNotificationsEnabled).toBe(false)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'owner-1' },
      data: { emailNotificationsEnabled: false },
    })
  })

  it('returns 503 when the database is unavailable', async () => {
    verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
    resolveCanonicalOwner.mockResolvedValue({ id: 'owner-1', email: OWNER_EMAIL, emailNotificationsEnabled: true })
    getPrismaClient.mockResolvedValue(null)

    const response = await PATCH(createRequest({ method: 'PATCH', body: { enabled: false } }), PARAMS)
    expect(response.status).toBe(503)
  })
})
