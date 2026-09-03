import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/server/posthog-query.js', () => ({
  runHogQLQuery: vi.fn(),
}))

import { runHogQLQuery } from '../lib/server/posthog-query.js'
import {
  resolveRangeBounds,
  getMarketingVisitors,
  getDailyMarketingVisitors,
  getShareMetrics,
  getGuestRoomReach,
} from '../lib/server/admin-analytics-posthog.js'

beforeEach(() => {
  runHogQLQuery.mockReset()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

describe('resolveRangeBounds', () => {
  it('computes a UTC day-aligned window of the requested length', () => {
    const now = new Date('2026-09-15T13:45:00.000Z')
    const { since, until } = resolveRangeBounds('7d', now)
    expect(until.toISOString()).toBe('2026-09-16T00:00:00.000Z')
    expect(since.toISOString()).toBe('2026-09-09T00:00:00.000Z')
  })

  it('throws for an unsupported range instead of silently defaulting', () => {
    expect(() => resolveRangeBounds('all')).toThrow()
    expect(() => resolveRangeBounds('bogus')).toThrow()
  })
})

describe('getMarketingVisitors', () => {
  it('filters on $pageview + page_type=landing only, no dashboard/admin/guest-room contamination', async () => {
    runHogQLQuery.mockResolvedValue([[57]])
    const result = await getMarketingVisitors('30d')

    expect(result).toEqual({ count: 57 })
    const [hogql] = runHogQLQuery.mock.calls[0]
    expect(hogql).toContain("event = '$pageview'")
    expect(hogql).toContain("properties.page_type = 'landing'")
    expect(hogql).toContain('count(DISTINCT distinct_id)')
    expect(hogql).not.toMatch(/dashboard|admin|room_viewed/i)
  })
})

describe('getDailyMarketingVisitors', () => {
  it('returns an ordered, zero-filled daily series with no missing days', async () => {
    const now = new Date('2026-09-05T00:00:00.000Z')
    vi.setSystemTime(now)
    runHogQLQuery.mockResolvedValue([
      ['2026-08-30', 3],
      ['2026-09-01', 5],
    ])

    const series = await getDailyMarketingVisitors('7d')

    // now = 2026-09-05T00:00:00Z -> until = start of 2026-09-06 (exclusive
    // upper bound, so "today so far" is included as a full day) -> since =
    // until - 7 days = start of 2026-08-30.
    expect(series).toHaveLength(7)
    expect(series.map((d) => d.date)).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-03', '2026-09-04', '2026-09-05',
    ])
    expect(series.find((d) => d.date === '2026-08-30').visitors).toBe(3)
    expect(series.find((d) => d.date === '2026-09-01').visitors).toBe(5)
    expect(series.find((d) => d.date === '2026-08-31').visitors).toBe(0)
    vi.useRealTimers()
  })
})

describe('getShareMetrics', () => {
  it('includes exactly the four approved share-intent events and labels them as intent, not success', async () => {
    runHogQLQuery
      .mockResolvedValueOnce([
        ['whatsapp_share_clicked', 10],
        ['native_share_clicked', 4],
        ['copy_link_clicked', 6],
        ['qr_opened', 2],
      ])
      .mockResolvedValueOnce([[15]])

    const result = await getShareMetrics('30d')

    expect(result).toEqual({
      totalActions: 22,
      roomsWithShareIntent: 15,
      byType: { whatsapp: 10, native: 4, copyLink: 6, qr: 2 },
    })

    const [byTypeQuery] = runHogQLQuery.mock.calls[0]
    for (const name of ['whatsapp_share_clicked', 'native_share_clicked', 'copy_link_clicked', 'qr_opened']) {
      expect(byTypeQuery).toContain(name)
    }
    // No unrelated event name should be part of the filter.
    expect(byTypeQuery).not.toContain('room_viewed')
    expect(byTypeQuery).not.toContain('$pageview')
  })

  it('ignores unexpected event names PostHog might return without crashing', async () => {
    runHogQLQuery
      .mockResolvedValueOnce([['some_unexpected_event', 999]])
      .mockResolvedValueOnce([[0]])

    const result = await getShareMetrics('30d')
    // The unexpected event still counts toward totalActions (upstream already
    // filtered by our WHERE clause) but must not be attributed to any known type.
    expect(result.totalActions).toBe(999)
    expect(result.byType).toEqual({ whatsapp: 0, native: 0, copyLink: 0, qr: 0 })
  })
})

describe('getGuestRoomReach', () => {
  it('filters on room_viewed with is_host=false, excluding host views', async () => {
    runHogQLQuery.mockResolvedValue([[120, 34]])
    const result = await getGuestRoomReach('30d')

    expect(result).toEqual({ views: 120, roomsReached: 34 })
    const [hogql] = runHogQLQuery.mock.calls[0]
    expect(hogql).toContain("event = 'room_viewed'")
    expect(hogql).toContain('properties.is_host = false')
  })
})
