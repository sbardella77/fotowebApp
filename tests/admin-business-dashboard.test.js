import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/admin-analytics-posthog', async () => {
  const actual = await vi.importActual('@/lib/server/admin-analytics-posthog')
  return { ...actual, getTrafficMetrics: vi.fn() }
})

vi.mock('@/lib/server/admin-business-metrics', () => ({
  getPostgresBusinessMetrics: vi.fn(),
}))

const FAKE_POSTGRES_METRICS = {
  since: '2026-08-05T00:00:00.000Z',
  until: '2026-09-04T00:00:00.000Z',
  previous: { since: '2026-07-06T00:00:00.000Z', until: '2026-08-05T00:00:00.000Z' },
  signups: { current: 10, previous: 5, percentageChange: { value: 100, trend: 'up' } },
  eventsCreated: { current: 8, previous: 4, percentageChange: { value: 100, trend: 'up' } },
  firstEvents: { current: 6, previous: 3, percentageChange: { value: 100, trend: 'up' } },
  coreActivatedOwners: { current: 3, previous: 1, percentageChange: { value: 200, trend: 'up' } },
  paidAccounts: { current: 2 },
  trends: { signups: [], eventsCreated: [], coreActivation: [] },
}

const FAKE_POSTHOG_METRICS = {
  visitors: { count: 100, daily: [{ date: '2026-09-01', visitors: 100 }] },
  sharing: { totalActions: 5, roomsWithShareIntent: 2, byType: { whatsapp: 5, native: 0, copyLink: 0, qr: 0 } },
  guestRoomReach: { views: 9, roomsReached: 3 },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeFunnel', () => {
  it('computes conversion-from-previous-stage for a normal funnel', async () => {
    const { computeFunnel } = await import('@/lib/server/admin-business-dashboard')
    const stages = computeFunnel({ visitors: 100, signups: 10, firstEvents: 6, coreActivated: 3, paid: 2 })

    expect(stages.map((s) => s.key)).toEqual(['visitors', 'signups', 'firstEvents', 'coreActivated', 'paid'])
    expect(stages[0].conversionFromPrevious).toBeNull() // first stage has no "previous"
    expect(stages[1].conversionFromPrevious).toBe(10) // 10/100
    expect(stages[2].conversionFromPrevious).toBe(60) // 6/10
    expect(stages[3].conversionFromPrevious).toBe(50) // 3/6
    expect(stages[4].conversionFromPrevious).toBeCloseTo(66.7, 1) // 2/3
  })

  it('a zero denominator produces null, never NaN or Infinity', async () => {
    const { computeFunnel } = await import('@/lib/server/admin-business-dashboard')
    const stages = computeFunnel({ visitors: 0, signups: 5, firstEvents: 0, coreActivated: 0, paid: 0 })

    for (const stage of stages) {
      expect(Number.isNaN(stage.conversionFromPrevious)).toBe(false)
      expect(stage.conversionFromPrevious).not.toBe(Infinity)
    }
    expect(stages[1].conversionFromPrevious).toBeNull() // signups/visitors, visitors=0
  })

  it('a null count (PostHog unavailable) does not poison downstream stages beyond the one that depends on it', async () => {
    const { computeFunnel } = await import('@/lib/server/admin-business-dashboard')
    const stages = computeFunnel({ visitors: null, signups: 10, firstEvents: 6, coreActivated: 3, paid: 2 })

    expect(stages[0].count).toBeNull()
    expect(stages[1].conversionFromPrevious).toBeNull() // depends on null visitors
    expect(stages[2].conversionFromPrevious).toBe(60) // firstEvents/signups — unaffected, both known
  })

  it('exact 100% conversion is preserved (not rounded away or misrepresented)', async () => {
    const { computeFunnel } = await import('@/lib/server/admin-business-dashboard')
    const stages = computeFunnel({ visitors: 50, signups: 50, firstEvents: 50, coreActivated: 50, paid: 50 })

    expect(stages[1].conversionFromPrevious).toBe(100)
  })

  it('both stages zero yields null (0/0), not a misleading 100%', async () => {
    const { computeFunnel } = await import('@/lib/server/admin-business-dashboard')
    const stages = computeFunnel({ visitors: 0, signups: 0, firstEvents: 0, coreActivated: 0, paid: 0 })

    expect(stages[1].conversionFromPrevious).toBeNull()
  })
})

describe('getAdminBusinessMetrics — partial-failure model', () => {
  it('PostHog success: acquisition.visitors and engagement are populated, postHog.status is ok', async () => {
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const { getPostgresBusinessMetrics } = await import('@/lib/server/admin-business-metrics')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    getPostgresBusinessMetrics.mockResolvedValue(FAKE_POSTGRES_METRICS)
    getTrafficMetrics.mockResolvedValue(FAKE_POSTHOG_METRICS)

    const result = await getAdminBusinessMetrics({ prisma: {}, range: '30d' })

    expect(result.postHog.status).toBe('ok')
    expect(result.acquisition.visitors.current).toBe(100)
    expect(result.engagement.roomsWithShareIntent).toBe(2)
    expect(result.engagement.shareActions).toBe(5)
    expect(result.engagement.roomsReached).toBe(3)
    expect(result.engagement.guestRoomViews).toBe(9)
    expect(result.trends.visitors).toEqual(FAKE_POSTHOG_METRICS.visitors.daily)
    expect(result.funnel.stages[0].count).toBe(100)
  })

  it('PostHog failure: Postgres-derived sections still populate normally, PostHog sections become null (never zero), status is unavailable', async () => {
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const { getPostgresBusinessMetrics } = await import('@/lib/server/admin-business-metrics')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    const { PostHogQueryError, POSTHOG_ERROR } = await import('@/lib/server/posthog-query')
    getPostgresBusinessMetrics.mockResolvedValue(FAKE_POSTGRES_METRICS)
    getTrafficMetrics.mockRejectedValue(new PostHogQueryError(POSTHOG_ERROR.TIMEOUT, 'timed out'))

    const result = await getAdminBusinessMetrics({ prisma: {}, range: '30d' })

    expect(result.postHog).toEqual({ status: 'unavailable', reason: POSTHOG_ERROR.TIMEOUT })
    // Postgres-derived: unaffected by the PostHog outage.
    expect(result.acquisition.signups.current).toBe(10)
    expect(result.activation.eventsCreated.current).toBe(8)
    expect(result.activation.coreActivatedOwners.current).toBe(3)
    expect(result.monetization.paidAccounts).toBe(2)
    // PostHog-derived: explicitly null, never coerced to 0.
    expect(result.acquisition.visitors.current).toBeNull()
    expect(result.engagement.roomsWithShareIntent).toBeNull()
    expect(result.engagement.shareActions).toBeNull()
    expect(result.engagement.roomsReached).toBeNull()
    expect(result.engagement.guestRoomViews).toBeNull()
    expect(result.trends.visitors).toBeNull()
    expect(result.funnel.stages[0].count).toBeNull()
  })

  it('a non-PostHogQueryError thrown by getTrafficMetrics still degrades gracefully instead of crashing the whole endpoint', async () => {
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const { getPostgresBusinessMetrics } = await import('@/lib/server/admin-business-metrics')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    getPostgresBusinessMetrics.mockResolvedValue(FAKE_POSTGRES_METRICS)
    getTrafficMetrics.mockRejectedValue(new Error('unexpected network error'))

    const result = await getAdminBusinessMetrics({ prisma: {}, range: '30d' })

    expect(result.postHog.status).toBe('unavailable')
    expect(result.acquisition.signups.current).toBe(10) // Postgres side unaffected
  })

  it('the funnel is explicitly labeled a stage funnel, not a strict cohort funnel', async () => {
    const { getAdminBusinessMetrics } = await import('@/lib/server/admin-business-dashboard')
    const { getPostgresBusinessMetrics } = await import('@/lib/server/admin-business-metrics')
    const { getTrafficMetrics } = await import('@/lib/server/admin-analytics-posthog')
    getPostgresBusinessMetrics.mockResolvedValue(FAKE_POSTGRES_METRICS)
    getTrafficMetrics.mockResolvedValue(FAKE_POSTHOG_METRICS)

    const result = await getAdminBusinessMetrics({ prisma: {}, range: '30d' })

    expect(result.funnel.isStageFunnel).toBe(true)
  })
})
