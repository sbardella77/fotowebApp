import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))

const { getGalleryRepository } = vi.hoisted(() => ({ getGalleryRepository: vi.fn() }))
vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository,
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

import { getMyPhotoLikes, setPhotoLike, VOTER_COOKIE_NAME } from '@/lib/server/photo-likes'

const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'
const PHOTO_ID = 'photo-1'
const VOTER = '11111111-2222-4333-8444-555555555555'

function makeRequest({ origin = 'http://localhost:3000', voter = null, ip = '198.51.100.9' } = {}) {
  return {
    headers: {
      get: (name) => {
        if (name === 'origin') return origin
        if (name === 'x-forwarded-for') return ip
        return null
      },
    },
    cookies: { get: (name) => (name === VOTER_COOKIE_NAME && voter ? { value: voter } : undefined) },
  }
}

function makePrisma({ photo = { id: PHOTO_ID }, created = 1, deleted = 1, likeCount = 1, likes = [] } = {}) {
  const tx = {
    photoLike: {
      createMany: vi.fn().mockResolvedValue({ count: created }),
      deleteMany: vi.fn().mockResolvedValue({ count: deleted }),
    },
    photo: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({ likeCount }),
    },
  }
  return {
    tx,
    photo: { findFirst: vi.fn().mockResolvedValue(photo) },
    photoLike: { findMany: vi.fn().mockResolvedValue(likes) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'http://localhost:3000'
  getGalleryRepository.mockResolvedValue({
    getEventBySlug: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }),
  })
})

describe('setPhotoLike', () => {
  it('likes a visible photo, increments the counter and issues a voter cookie', async () => {
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const res = await setPhotoLike(makeRequest(), SLUG, PHOTO_ID, true)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ photoId: PHOTO_ID, liked: true, likeCount: 1 })
    expect(prisma.photo.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: PHOTO_ID, eventId: EVENT_ID, status: 'VISIBLE' },
    }))
    expect(prisma.tx.photo.update).toHaveBeenCalledWith({ where: { id: PHOTO_ID }, data: { likeCount: { increment: 1 } } })
    const cookie = res.cookies.get(VOTER_COOKIE_NAME)
    expect(cookie.value).toMatch(/^[0-9a-f-]{36}$/)
    expect(cookie.httpOnly).toBe(true)
  })

  it('is idempotent: a duplicate like does not increment and keeps the existing cookie', async () => {
    const prisma = makePrisma({ created: 0, likeCount: 5 })
    getPrismaClient.mockResolvedValue(prisma)

    const res = await setPhotoLike(makeRequest({ voter: VOTER }), SLUG, PHOTO_ID, true)

    expect((await res.json()).likeCount).toBe(5)
    expect(prisma.tx.photo.update).not.toHaveBeenCalled()
    expect(prisma.tx.photoLike.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ photoId: PHOTO_ID, eventId: EVENT_ID, voterId: VOTER }],
      skipDuplicates: true,
    }))
    expect(res.cookies.get(VOTER_COOKIE_NAME)).toBeUndefined()
  })

  it('unlike decrements only when a row was removed, never below zero', async () => {
    const prisma = makePrisma({ likeCount: 0 })
    getPrismaClient.mockResolvedValue(prisma)

    await setPhotoLike(makeRequest({ voter: VOTER }), SLUG, PHOTO_ID, false)

    expect(prisma.tx.photoLike.deleteMany).toHaveBeenCalledWith({ where: { photoId: PHOTO_ID, voterId: VOTER } })
    expect(prisma.tx.photo.updateMany).toHaveBeenCalledWith({
      where: { id: PHOTO_ID, likeCount: { gt: 0 } },
      data: { likeCount: { decrement: 1 } },
    })
  })

  it('rejects cross-origin requests before touching the database', async () => {
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)

    const res = await setPhotoLike(makeRequest({ origin: 'https://evil.example' }), SLUG, PHOTO_ID, true)

    expect(res.status).toBe(403)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 404 for a photo outside the event or hidden', async () => {
    getPrismaClient.mockResolvedValue(makePrisma({ photo: null }))
    const res = await setPhotoLike(makeRequest(), SLUG, 'other', true)
    expect(res.status).toBe(404)
  })

  it('ignores a malformed voter cookie and issues a fresh one', async () => {
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)
    const res = await setPhotoLike(makeRequest({ voter: 'not-a-uuid' }), SLUG, PHOTO_ID, true)
    expect(res.cookies.get(VOTER_COOKIE_NAME).value).not.toBe('not-a-uuid')
  })
})

describe('getMyPhotoLikes', () => {
  it('returns an empty list without a voter cookie and never queries', async () => {
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)
    const res = await getMyPhotoLikes(makeRequest(), SLUG)
    expect(await res.json()).toEqual({ likedPhotoIds: [] })
    expect(prisma.photoLike.findMany).not.toHaveBeenCalled()
  })

  it('returns only this voter\'s likes for this event', async () => {
    const prisma = makePrisma({ likes: [{ photoId: 'a' }, { photoId: 'b' }] })
    getPrismaClient.mockResolvedValue(prisma)
    const res = await getMyPhotoLikes(makeRequest({ voter: VOTER }), SLUG)
    expect(await res.json()).toEqual({ likedPhotoIds: ['a', 'b'] })
    expect(prisma.photoLike.findMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, voterId: VOTER },
      select: { photoId: true },
    })
  })
})
