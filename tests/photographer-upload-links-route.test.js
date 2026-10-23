import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))
vi.mock('@vercel/blob', () => ({ head: vi.fn(), BlobError: class BlobError extends Error {} }))
vi.mock('@/lib/server/derivative-cleanup', () => ({
  deletePhotoDerivatives: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
  deletePhotoDerivativesBatch: vi.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
}))
vi.mock('@/lib/server/storage', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deleteStoredFile: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert: vi.fn().mockResolvedValue({ sent: false }) }))
vi.mock('@/lib/server/management-token', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, verifyManagementToken: vi.fn().mockReturnValue(true) }
})

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))

const { getGalleryRepository } = vi.hoisted(() => ({ getGalleryRepository: vi.fn() }))
vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository,
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

import { PhotographerLinkLimitError } from '@/lib/server/prisma-gallery-repository'
import { GET, POST, DELETE } from '@/app/api/[[...path]]/route'

const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'

function createRequest({ method = 'GET', body, cookie = 'session-token' } = {}) {
  return {
    method,
    cookies: {
      get: vi.fn((name) => (name === 'snaprooms_owner_session' && cookie ? { value: cookie } : undefined)),
    },
    headers: { get: vi.fn(() => null) },
    json: vi.fn().mockResolvedValue(body ?? {}),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://snaprooms.app'
  verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
  verifySameOriginRequest.mockReturnValue({ allowed: true })
  requireCsrfProtection.mockReturnValue({ success: true })
  getPrismaClient.mockResolvedValue(null) // skips the hasPrivateDelivery check branch
})

describe('POST /api/owner/events/:slug/photographer-links', () => {
  it('creates a link with a label and returns the raw token', async () => {
    const createLink = vi.fn().mockResolvedValue({ id: 'link-1', label: 'Mario', tokenHash: 'h' })
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      createPhotographerUploadLink: createLink,
    })

    const response = await POST(
      createRequest({ method: 'POST', body: { label: 'Mario' } }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.linkId).toBe('link-1')
    expect(body.label).toBe('Mario')
    expect(typeof body.token).toBe('string')
    expect(body.url).toContain('/photographer-upload/')
    expect(createLink).toHaveBeenCalledWith(EVENT_ID, { tokenHash: expect.any(String), label: 'Mario' })
  })

  it('creates a link without a label (label omitted)', async () => {
    const createLink = vi.fn().mockResolvedValue({ id: 'link-1', label: null, tokenHash: 'h' })
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      createPhotographerUploadLink: createLink,
    })

    const response = await POST(
      createRequest({ method: 'POST', body: {} }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )

    expect(response.status).toBe(200)
    expect(createLink).toHaveBeenCalledWith(EVENT_ID, { tokenHash: expect.any(String), label: null })
  })

  it('returns 400 when the event already has 10 active links', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      createPhotographerUploadLink: vi.fn().mockRejectedValue(new PhotographerLinkLimitError()),
    })

    const response = await POST(
      createRequest({ method: 'POST', body: {} }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )

    expect(response.status).toBe(400)
  })

  it('returns 404 for an event the owner does not own', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue(null),
      createPhotographerUploadLink: vi.fn(),
    })

    const response = await POST(
      createRequest({ method: 'POST', body: {} }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )

    expect(response.status).toBe(404)
  })

  it('rejects a label longer than 60 characters', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      createPhotographerUploadLink: vi.fn(),
    })

    const response = await POST(
      createRequest({ method: 'POST', body: { label: 'x'.repeat(61) } }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )

    expect(response.status).toBe(400)
  })
})

describe('GET /api/owner/events/:slug/photographer-links', () => {
  it('lists links without ever exposing tokenHash', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      listPhotographerUploadLinks: vi.fn().mockResolvedValue([
        { id: 'link-1', label: 'Mario', tokenHash: 'secret-hash', createdAt: new Date(), expiresAt: null, revokedAt: null, photoCount: 3 },
      ]),
    })

    const response = await GET(
      createRequest({ method: 'GET' }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.links).toHaveLength(1)
    expect(body.links[0].photoCount).toBe(3)
    expect(body.links[0].tokenHash).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('secret-hash')
  })
})

describe('DELETE /api/owner/events/:slug/photographer-links/:linkId', () => {
  it('revokes a link belonging to the event', async () => {
    const revoke = vi.fn().mockResolvedValue({ id: 'link-1', revokedAt: new Date() })
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      revokePhotographerUploadLink: revoke,
    })

    const response = await DELETE(
      createRequest({ method: 'DELETE' }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links', 'link-1'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.revoked).toBe(true)
    expect(revoke).toHaveBeenCalledWith(EVENT_ID, 'link-1')
  })

  it('returns 404 for a link that does not belong to this event', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, ownerId: 'owner-1' }),
      revokePhotographerUploadLink: vi.fn().mockResolvedValue(null),
    })

    const response = await DELETE(
      createRequest({ method: 'DELETE' }),
      { params: { path: ['owner', 'events', SLUG, 'photographer-links', 'someone-elses-link'] } },
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/photographer-upload/:token/assets — per-link isolation', () => {
  it('only returns assets uploaded through this specific link', async () => {
    const listByLink = vi.fn().mockResolvedValue([{ id: 'asset-1', photographerLinkId: 'link-1' }])
    getGalleryRepository.mockResolvedValue({
      getPhotographerLinkByTokenHash: vi.fn().mockResolvedValue({
        event: { id: EVENT_ID, slug: SLUG },
        link: { id: 'link-1', revokedAt: null, expiresAt: null },
      }),
      listPrivateAssetsByPhotographerLinkId: listByLink,
    })

    const response = await GET(
      createRequest({ method: 'GET' }),
      { params: { path: ['photographer-upload', 'some-token', 'assets'] } },
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assets).toHaveLength(1)
    expect(listByLink).toHaveBeenCalledWith('link-1')
  })

  it('returns 403 for a revoked/expired/unknown link', async () => {
    getGalleryRepository.mockResolvedValue({
      getPhotographerLinkByTokenHash: vi.fn().mockResolvedValue(null),
      listPrivateAssetsByPhotographerLinkId: vi.fn(),
    })

    const response = await GET(
      createRequest({ method: 'GET' }),
      { params: { path: ['photographer-upload', 'bad-token', 'assets'] } },
    )

    expect(response.status).toBe(403)
  })
})
