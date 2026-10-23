import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'

const { getPrismaClient, getAppUrl, sendEventExpiringReminderEmail, sendOpsAlert } = vi.hoisted(() => ({
  getPrismaClient: vi.fn(),
  getAppUrl: vi.fn(() => 'https://snaprooms.app'),
  sendEventExpiringReminderEmail: vi.fn(),
  sendOpsAlert: vi.fn().mockResolvedValue({ sent: true }),
}))

vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))
vi.mock('@/lib/server/event-routes', () => ({ getAppUrl }))
vi.mock('@/lib/server/owner-notification-emails', () => ({ sendEventExpiringReminderEmail }))
vi.mock('@/lib/server/ops-alerts', () => ({ sendOpsAlert }))

import { GET } from '@/app/api/cron/notify-event-expiring/route'

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

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function freeEvent(overrides = {}) {
  return {
    id: 'event_1',
    slug: 'wedding-2025',
    name: 'Wedding',
    billingTier: null,
    archiveLocked: false,
    vaultExtendedUntil: null,
    gracePeriodUntil: null,
    retentionReminderT30SentAt: null,
    retentionReminderT7SentAt: null,
    retentionReminderT0SentAt: null,
    owner: { id: 'owner_1', email: 'owner@example.com', plan: 'free', subscriptionCanceledAt: null, emailNotificationsEnabled: true },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-23T00:00:00.000Z'))
  getAppUrl.mockReturnValue('https://snaprooms.app')
  sendOpsAlert.mockResolvedValue({ sent: true })
  sendEventExpiringReminderEmail.mockResolvedValue({ sent: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cron/notify-event-expiring', () => {
  it('rejects a request with a wrong bearer token', async () => {
    const response = await GET(createRequest('wrong-secret'))
    expect(response.status).toBe(401)
  })

  it('returns 503 when the database is unavailable', async () => {
    getPrismaClient.mockResolvedValue(null)
    const response = await GET(createRequest())
    expect(response.status).toBe(503)
  })

  it('sends the T30 reminder for a Free event 20 days from its 90-day cutoff', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-70) }) // 90 - 70 = 20 days remaining
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.notified).toBe(1)
    expect(sendEventExpiringReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ event, daysRemaining: 20, appUrl: 'https://snaprooms.app' }),
    )
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { retentionReminderT30SentAt: expect.any(Date) },
    })
  })

  it('sends T7 (not T30 again) once the event is inside 7 days and T30 already fired', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-85), retentionReminderT30SentAt: new Date() }) // 5 days remaining
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())

    expect(response.status).toBe(200)
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { retentionReminderT7SentAt: expect.any(Date) },
    })
  })

  it('does not resend a stage that was already notified', async () => {
    const event = freeEvent({ createdAt: daysFromNow(-70), retentionReminderT30SentAt: new Date() })
    const prisma = buildPrisma([event])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.scanned).toBe(1)
    expect(body.notified).toBe(0)
    expect(sendEventExpiringReminderEmail).not.toHaveBeenCalled()
    expect(prisma.event.update).not.toHaveBeenCalled()
  })

  it('skips an event with no expiration (archived or covered by an active premium plan)', async () => {
    const archived = freeEvent({ id: 'event_archived', archiveLocked: true })
    const premiumOwner = freeEvent({ id: 'event_premium', owner: { ...freeEvent().owner, plan: 'professional' } })
    const prisma = buildPrisma([archived, premiumOwner])
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.notified).toBe(0)
    expect(sendEventExpiringReminderEmail).not.toHaveBeenCalled()
  })

  it('a failure on one event does not stop the others', async () => {
    const eventA = freeEvent({ id: 'event_a', createdAt: daysFromNow(-70) })
    const eventB = freeEvent({ id: 'event_b', createdAt: daysFromNow(-70) })
    const prisma = buildPrisma([eventA, eventB])
    getPrismaClient.mockResolvedValue(prisma)
    sendEventExpiringReminderEmail.mockRejectedValueOnce(new Error('send blew up')).mockResolvedValueOnce({ sent: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.scanned).toBe(2)
    expect(body.notified).toBe(1)
    expect(prisma.event.update).toHaveBeenCalledOnce()
  })

  it('run-level failure returns 500 and sends exactly one ops alert', async () => {
    const prisma = { event: { findMany: vi.fn().mockRejectedValue(new Error('db unreachable')), update: vi.fn() } }
    getPrismaClient.mockResolvedValue(prisma)

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Event-expiring reminder run failed')
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    expect(sendOpsAlert.mock.calls[0][0].type).toBe('ops:cron:event_expiring_failed')
  })
})
