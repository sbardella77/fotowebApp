import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient,
  getAdminAuthDriver: vi.fn(),
  getDataAccessDriver: vi.fn(),
}))

const { getGalleryRepository } = vi.hoisted(() => ({ getGalleryRepository: vi.fn() }))
vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository,
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const { verifyTurnstileToken } = vi.hoisted(() => ({ verifyTurnstileToken: vi.fn() }))
vi.mock('@/lib/server/turnstile', () => ({ verifyTurnstileToken }))

const { verifyOwnerSessionToken } = vi.hoisted(() => ({ verifyOwnerSessionToken: vi.fn() }))
vi.mock('@/lib/server/owner-auth', () => ({ OWNER_COOKIE_NAME: 'snaprooms_owner_session', verifyOwnerSessionToken }))

vi.mock('@/lib/analytics/track-server', () => ({ trackServerEvent: vi.fn() }))

import { createEvent } from '@/lib/server/event-routes'

let ipCounter = 0
function makeRequest(body, { sessionCookie } = {}) {
  // Fresh IP per request so the in-memory create-event rate limit never trips.
  const ip = `198.51.100.${++ipCounter}`
  return {
    method: 'POST',
    json: async () => body,
    headers: { get: (name) => (name === 'x-forwarded-for' ? ip : null) },
    cookies: { get: (name) => (name === 'snaprooms_owner_session' && sessionCookie ? { value: sessionCookie } : undefined) },
  }
}

let repository
beforeEach(() => {
  vi.clearAllMocks()
  getPrismaClient.mockResolvedValue(null)
  verifyOwnerSessionToken.mockResolvedValue(null)
  repository = {
    createEvent: vi.fn().mockResolvedValue({ id: 'e1', slug: 'party', name: 'Party' }),
    getOrCreateOwnerByEmail: vi.fn().mockResolvedValue({ id: 'o1', email: 'a@b.com', emailVerifiedAt: null }),
    setEventOwnerEmail: vi.fn().mockResolvedValue({}),
  }
  getGalleryRepository.mockResolvedValue(repository)
})

describe('createEvent — Turnstile gate', () => {
  it('refuses public room creation when the challenge fails', async () => {
    verifyTurnstileToken.mockResolvedValue({ success: false })
    const response = await createEvent(makeRequest({ name: 'Party', ownerEmail: 'a@b.com', turnstileToken: 'bad' }))
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('captcha_failed')
    expect(repository.createEvent).not.toHaveBeenCalled()
    expect(verifyTurnstileToken).toHaveBeenCalledWith('bad', expect.objectContaining({ expectedAction: 'create_room' }))
  })

  it('creates the room when the challenge passes and reports the owner as unverified', async () => {
    verifyTurnstileToken.mockResolvedValue({ success: true })
    const response = await createEvent(makeRequest({ name: 'Party', ownerEmail: 'a@b.com', turnstileToken: 'ok' }))
    expect(response.status).toBe(201)
    expect((await response.json()).ownerEmailVerified).toBe(false)
  })

  it('skips the challenge for a signed-in owner creating a room for their own account', async () => {
    verifyOwnerSessionToken.mockResolvedValue('a@b.com')
    const response = await createEvent(makeRequest({ name: 'Party', ownerEmail: 'A@B.com' }, { sessionCookie: 'sig' }))
    expect(response.status).toBe(201)
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })

  it('still challenges a signed-in owner who names a different email', async () => {
    verifyOwnerSessionToken.mockResolvedValue('me@b.com')
    verifyTurnstileToken.mockResolvedValue({ success: false })
    const response = await createEvent(makeRequest({ name: 'Party', ownerEmail: 'victim@b.com' }, { sessionCookie: 'sig' }))
    expect(response.status).toBe(403)
  })

  it('skips the challenge for trusted (admin) callers', async () => {
    const response = await createEvent(makeRequest({ name: 'Party' }), { trustedCaller: true })
    expect(response.status).toBe(201)
    expect(verifyTurnstileToken).not.toHaveBeenCalled()
  })
})
