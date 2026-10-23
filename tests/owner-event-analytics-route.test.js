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

import { GET } from '@/app/api/[[...path]]/route'

const OWNER_EMAIL = 'owner@example.com'
const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'

function createRequest({ cookie = 'session-token' } = {}) {
  return {
    method: 'GET',
    cookies: {
      get: vi.fn((name) => (name === 'snaprooms_owner_session' && cookie ? { value: cookie } : undefined)),
    },
    headers: { get: vi.fn(() => null) },
  }
}

function makePrisma({ views = 0, uploads = 0, uploadsByActor = [], upsellCounts = [] } = {}) {
  return {
    eventPageView: { count: vi.fn().mockResolvedValue(views) },
    photo: {
      count: vi.fn().mockResolvedValue(uploads),
      groupBy: vi.fn().mockResolvedValue(uploadsByActor),
    },
    upsellEvent: { groupBy: vi.fn().mockResolvedValue(upsellCounts) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyOwnerSessionToken.mockResolvedValue(OWNER_EMAIL)
})

describe('GET /api/owner/events/:slug/analytics', () => {
  it('requires owner authentication', async () => {
    verifyOwnerSessionToken.mockResolvedValue(null)
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn() })

    const response = await GET(createRequest({ cookie: null }), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })
    expect(response.status).toBe(401)
  })

  it('returns 404 for an event the owner does not own', async () => {
    getGalleryRepository.mockResolvedValue({ getEventBySlugAndOwner: vi.fn().mockResolvedValue(null) })

    const response = await GET(createRequest(), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })
    expect(response.status).toBe(404)
  })

  it('returns 503 when the database is unavailable', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, originalDownloadUnlocked: false }),
    })
    getPrismaClient.mockResolvedValue(null)

    const response = await GET(createRequest(), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })
    expect(response.status).toBe(503)
  })

  it('computes viewToUploadRate, actor breakdown, unlock status and the upsell funnel', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, originalDownloadUnlocked: true }),
    })
    getPrismaClient.mockResolvedValue(makePrisma({
      views: 50,
      uploads: 10,
      uploadsByActor: [
        { uploadActorType: 'guest', _count: { id: 8 } },
        { uploadActorType: null, _count: { id: 2 } },
      ],
      upsellCounts: [
        { eventName: 'upsell_impression', _count: { id: 20 } },
        { eventName: 'upsell_click', _count: { id: 5 } },
        { eventName: 'upsell_checkout_start', _count: { id: 2 } },
        { eventName: 'upsell_conversion', _count: { id: 1 } },
      ],
    }))

    const response = await GET(createRequest(), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.views).toBe(50)
    expect(body.uploads).toBe(10)
    expect(body.viewToUploadRate).toBe(0.2)
    expect(body.uploadsByActor).toEqual({ guest: 8, unknown: 2 })
    expect(body.originalQualityUnlocked).toBe(true)
    expect(body.upsellFunnel).toEqual({ impressions: 20, clicks: 5, checkoutStarts: 2, conversions: 1 })
  })

  it('viewToUploadRate is null (not NaN/Infinity) when there are zero views', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, originalDownloadUnlocked: false }),
    })
    getPrismaClient.mockResolvedValue(makePrisma({ views: 0, uploads: 3 }))

    const response = await GET(createRequest(), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })
    const body = await response.json()

    expect(body.viewToUploadRate).toBeNull()
  })

  it('scopes all queries to this event only (cross-event isolation)', async () => {
    getGalleryRepository.mockResolvedValue({
      getEventBySlugAndOwner: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG, originalDownloadUnlocked: false }),
    })
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    await GET(createRequest(), { params: { path: ['owner', 'events', SLUG, 'analytics'] } })

    expect(prisma.eventPageView.count).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } })
    expect(prisma.photo.count).toHaveBeenCalledWith({ where: { eventId: EVENT_ID, status: 'VISIBLE' } })
    expect(prisma.photo.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: EVENT_ID, status: 'VISIBLE' } }))
    expect(prisma.upsellEvent.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: EVENT_ID } }))
  })
})
