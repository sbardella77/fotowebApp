import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))

const { getGalleryRepository } = vi.hoisted(() => ({ getGalleryRepository: vi.fn() }))
vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository,
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

import { trackRoomView } from '@/lib/server/event-routes'

const SLUG = 'wedding-2026'
const EVENT_ID = 'event-1'

function makeRequest({ ip = '198.51.100.7' } = {}) {
  return {
    method: 'POST',
    headers: {
      get: (name) => (name === 'x-forwarded-for' ? ip : null),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getGalleryRepository.mockResolvedValue({
    getEventBySlug: vi.fn().mockResolvedValue({ id: EVENT_ID, slug: SLUG }),
  })
})

describe('trackRoomView', () => {
  it('records a page view for an existing event', async () => {
    const create = vi.fn().mockResolvedValue({})
    getPrismaClient.mockResolvedValue({ eventPageView: { create } })

    const response = await trackRoomView(makeRequest(), SLUG)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(create).toHaveBeenCalledWith({ data: { eventId: EVENT_ID } })
  })

  it('returns 404 for an unknown event and never touches the database', async () => {
    getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(null) })
    const create = vi.fn()
    getPrismaClient.mockResolvedValue({ eventPageView: { create } })

    const response = await trackRoomView(makeRequest(), 'unknown-slug')
    expect(response.status).toBe(404)
    expect(create).not.toHaveBeenCalled()
  })

  it('still returns ok when the database is unavailable (best-effort, never blocks)', async () => {
    getPrismaClient.mockResolvedValue(null)

    const response = await trackRoomView(makeRequest(), SLUG)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('swallows a database write failure without rejecting', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db unreachable'))
    getPrismaClient.mockResolvedValue({ eventPageView: { create } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await trackRoomView(makeRequest(), SLUG)
    expect(response.status).toBe(200)
  })

  it('rate-limits after the configured ceiling for the same (ip, event) pair', async () => {
    const create = vi.fn().mockResolvedValue({})
    getPrismaClient.mockResolvedValue({ eventPageView: { create } })

    let lastResponse
    for (let i = 0; i < 201; i++) {
      lastResponse = await trackRoomView(makeRequest(), SLUG)
    }

    expect(lastResponse.status).toBe(429)
  })

  it('a different event gets its own rate-limit bucket', async () => {
    const create = vi.fn().mockResolvedValue({})
    getPrismaClient.mockResolvedValue({ eventPageView: { create } })

    for (let i = 0; i < 200; i++) {
      await trackRoomView(makeRequest(), SLUG)
    }
    getGalleryRepository.mockResolvedValue({
      getEventBySlug: vi.fn().mockResolvedValue({ id: 'event-2', slug: 'other-event' }),
    })
    const response = await trackRoomView(makeRequest(), 'other-event')

    expect(response.status).not.toBe(429)
  })
})
