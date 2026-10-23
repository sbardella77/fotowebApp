import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const { getPrismaClient, getAppUrl, sendPhotoDigestEmail, sendOpsAlert } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
  getAppUrl: vi.fn(() => 'https://snaprooms.app'),
  sendPhotoDigestEmail: vi.fn(),
  sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))
vi.mock('@/lib/server/event-routes', () => ({ getAppUrl }))
vi.mock('@/lib/server/owner-notification-emails', () => ({ sendPhotoDigestEmail }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert }))

import { GET } from '@/app/api/cron/notify-photo-digest/route'

const originalEnv = process.env

beforeAll(() => {
  process.env = { ...originalEnv, CRON_SECRET: 'cron_secret_test' }
})

afterAll(() => {
  process.env = originalEnv
})

function createRequest(secret = 'cron_secret_test') {
  return {
    headers: {
      get: vi.fn((name) => (name.toLowerCase() === 'authorization' ? `Bearer ${secret}` : null)),
    },
  }
}

function buildPrisma(events) {
  return {
    event: {
      findMany: vi.fn().mockResolvedValue(events),
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getAppUrl.mockReturnValue('https://snaprooms.app')
  sendOpsAlert.mockResolvedValue({ sent: true })
})

describe('GET /api/cron/notify-photo-digest', () => {
  it('rejects a request with a wrong bearer token', async () => {
    const response = await GET(createRequest('wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 503 when the database is unavailable', async () => {
    getPrismaClient.mockResolvedValue(null)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe('Database not available')
  })

  it('sends a digest per event and decrements by the count read, not resets to zero', async () => {
    const event = {
      id: 'event_1',
      slug: 'wedding-2025',
      name: 'Wedding',
      pendingDigestPhotoCount: 5,
      owner: { id: 'owner_1', email: 'owner@example.com', emailNotificationsEnabled: true },
    }
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)
    sendPhotoDigestEmail.mockResolvedValue({ sent: true, id: 'email_1' })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.scanned).toBe(1)
    expect(body.notified).toBe(1)
    expect(body.skipped).toBe(0)

    expect(sendPhotoDigestEmail).toHaveBeenCalledWith({
      owner: event.owner,
      event,
      newPhotoCount: 5,
      appUrl: 'https://snaprooms.app',
    })
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { pendingDigestPhotoCount: { decrement: 5 }, lastPhotoDigestSentAt: expect.any(Date) },
    })
  })

  it('counts an unsent email (e.g. Resend not configured) as skipped but still resets the counter', async () => {
    const event = {
      id: 'event_1',
      slug: 'wedding-2025',
      name: 'Wedding',
      pendingDigestPhotoCount: 2,
      owner: { id: 'owner_1', email: 'owner@example.com', emailNotificationsEnabled: true },
    }
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)
    sendPhotoDigestEmail.mockResolvedValue({ sent: false, reason: 'resend_not_configured' })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.notified).toBe(0)
    expect(body.skipped).toBe(1)
    expect(prisma.event.update).toHaveBeenCalledOnce()
  })

  it('a failure on one event does not stop the others', async () => {
    const eventA = {
      id: 'event_a',
      slug: 'a',
      name: 'A',
      pendingDigestPhotoCount: 1,
      owner: { id: 'owner_a', email: 'a@example.com', emailNotificationsEnabled: true },
    }
    const eventB = {
      id: 'event_b',
      slug: 'b',
      name: 'B',
      pendingDigestPhotoCount: 1,
      owner: { id: 'owner_b', email: 'b@example.com', emailNotificationsEnabled: true },
    }
    const prisma = buildPrisma([eventA, eventB])
    getPrismaClient.mockResolvedValue(prisma)
    sendPhotoDigestEmail.mockRejectedValueOnce(new Error('send blew up')).mockResolvedValueOnce({ sent: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.scanned).toBe(2)
    expect(body.notified).toBe(1)
    expect(prisma.event.update).toHaveBeenCalledOnce()
  })

  it('run-level failure (e.g. findMany throws) returns 500 and sends exactly one ops alert', async () => {
    const prisma = {
      event: { findMany: vi.fn().mockRejectedValue(new Error('db unreachable')), update: vi.fn() },
    }
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Photo digest run failed')
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    expect(sendOpsAlert.mock.calls[0][0].type).toBe('ops:cron:photo_digest_failed')
  })
})
