/**
 * Admin Business Dashboard traffic metrics, backed by PostHog.
 *
 * PostHog is the best-available source for behavior that Postgres never
 * persists: marketing visitors, share intent, and Guest Room Reach. None of
 * these are authoritative product-state facts — see the doc comments on
 * each exported function for the exact caveats. Core Activation and paid
 * state remain Postgres-authoritative and are NOT computed here.
 *
 * Every HogQL string below is built exclusively from fixed literals and
 * server-derived timestamps (see resolveRangeBounds). The only
 * caller-controlled input is the `range` enum, which is validated by
 * lib/server/schemas.js (adminMetricsRangeSchema) before it ever reaches
 * this module — no request-supplied text is ever interpolated into a query.
 */

import { Redis } from '@upstash/redis'
import { runHogQLQuery } from '@/lib/server/posthog-query'

const MARKETING_PAGE_TYPE = 'landing'
const SHARE_EVENT_NAMES = ['whatsapp_share_clicked', 'native_share_clicked', 'copy_link_clicked', 'qr_opened']
const GUEST_ROOM_VIEWED_EVENT = 'room_viewed'
const CACHE_TTL_SECONDS = 600 // 10 minutes: early-stage traffic doesn't need second-level freshness.
const CACHE_VERSION = 'v1'

function formatHogQLDateTime(date) {
  // ClickHouse/HogQL toDateTime() reliably parses 'YYYY-MM-DD HH:MM:SS' in
  // UTC. Avoid the ISO 'T'/'Z' suffix, which is not the documented format.
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * range='all' is intentionally NOT resolved here — there is no trustworthy,
 * pre-verified "PostHog project start" boundary available in this repo, and
 * deriving one via a live MIN(timestamp) discovery query is deferred to a
 * follow-up rather than risking an unbounded historical scan in V1. Callers
 * must reject 'all' before calling this (see the admin route handler).
 */
export function resolveRangeBounds(range, now = new Date()) {
  const days = RANGE_DAYS[range]
  if (!days) {
    throw new Error(`resolveRangeBounds: unsupported range "${range}"`)
  }
  // Canonical aggregation timezone: UTC. Both the `since`/`until` boundary
  // and every daily bucket below are computed in UTC, independent of any
  // visitor's or admin's local timezone, so results are stable and
  // reproducible regardless of who requests them or when.
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000)
  return { since, until }
}

function buildDailyZeroFilledSeries(since, until, rowsByDate) {
  const series = []
  const cursor = new Date(since)
  while (cursor < until) {
    const dateKey = formatDateOnly(cursor)
    series.push({ date: dateKey, visitors: rowsByDate.get(dateKey) || 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

function getCacheClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    return new Redis({ url, token })
  } catch (error) {
    console.error('[admin-analytics-posthog] cache client init failed:', error.message)
    return null
  }
}

const cacheClient = typeof window === 'undefined' ? getCacheClient() : null

async function withCache(cacheKeyParts, compute) {
  const cacheKey = `posthog-metrics:${CACHE_VERSION}:${cacheKeyParts.join(':')}`
  if (cacheClient) {
    try {
      const cached = await cacheClient.get(cacheKey)
      if (cached) return cached
    } catch (error) {
      console.error('[admin-analytics-posthog] cache read failed:', error.message)
    }
  }

  const result = await compute()

  if (cacheClient) {
    try {
      await cacheClient.set(cacheKey, result, { ex: CACHE_TTL_SECONDS })
    } catch (error) {
      console.error('[admin-analytics-posthog] cache write failed:', error.message)
    }
  }

  return result
}

/**
 * Marketing Visitors = COUNT(DISTINCT distinct_id) of `$pageview` events
 * carrying properties.page_type = 'landing' (set by every marketing page's
 * trackPageView() call — see lib/analytics/track-client.js — and by no
 * other route in the app), within [since, until).
 *
 * Caveat: this counts distinct PostHog distinct_ids, not unique humans. A
 * visitor who clears cookies, uses multiple browsers/devices, or is never
 * identify()'d (true for all pre-signup marketing traffic, since identify()
 * only fires post-auth on /dashboard and /dashboard/login) will count more
 * than once. Do not present this as "unique people."
 */
export async function getMarketingVisitors(range) {
  const { since, until } = resolveRangeBounds(range)
  return withCache(['visitors', range], async () => {
    const rows = await runHogQLQuery(
      `SELECT count(DISTINCT distinct_id) AS visitors
       FROM events
       WHERE event = '$pageview'
         AND properties.page_type = '${MARKETING_PAGE_TYPE}'
         AND timestamp >= toDateTime('${formatHogQLDateTime(since)}')
         AND timestamp < toDateTime('${formatHogQLDateTime(until)}')`,
      'marketing_visitors',
    )
    const count = Number(rows?.[0]?.[0] ?? 0)
    if (!Number.isFinite(count)) {
      throw new Error('getMarketingVisitors: malformed count in PostHog response')
    }
    return { count }
  })
}

/** Daily trend for the same Marketing Visitors definition, zero-filled for days with no traffic. */
export async function getDailyMarketingVisitors(range) {
  const { since, until } = resolveRangeBounds(range)
  return withCache(['visitors-daily', range], async () => {
    const rows = await runHogQLQuery(
      `SELECT toDate(timestamp) AS day, count(DISTINCT distinct_id) AS visitors
       FROM events
       WHERE event = '$pageview'
         AND properties.page_type = '${MARKETING_PAGE_TYPE}'
         AND timestamp >= toDateTime('${formatHogQLDateTime(since)}')
         AND timestamp < toDateTime('${formatHogQLDateTime(until)}')
       GROUP BY day
       ORDER BY day`,
      'marketing_visitors_daily',
    )
    const rowsByDate = new Map()
    for (const row of rows) {
      const [day, visitors] = row
      rowsByDate.set(String(day).slice(0, 10), Number(visitors))
    }
    return buildDailyZeroFilledSeries(since, until, rowsByDate)
  })
}

/**
 * Share Diagnostics — client-side share INTENT only (see module doc). None
 * of these four events prove a share/copy/scan actually completed. Never
 * present this as "successful shares."
 */
export async function getShareMetrics(range) {
  const { since, until } = resolveRangeBounds(range)
  return withCache(['share', range], async () => {
    const eventList = SHARE_EVENT_NAMES.map((name) => `'${name}'`).join(', ')
    const sinceClause = `timestamp >= toDateTime('${formatHogQLDateTime(since)}') AND timestamp < toDateTime('${formatHogQLDateTime(until)}')`

    const [byTypeRows, totalRoomsRows] = await Promise.all([
      runHogQLQuery(
        `SELECT event, count() AS actions
         FROM events
         WHERE event IN (${eventList}) AND ${sinceClause}
         GROUP BY event`,
        'share_intent_by_type',
      ),
      runHogQLQuery(
        `SELECT count(DISTINCT properties.room_slug) AS rooms
         FROM events
         WHERE event IN (${eventList}) AND ${sinceClause}`,
        'share_intent_rooms',
      ),
    ])

    const byType = { whatsapp: 0, native: 0, copyLink: 0, qr: 0 }
    const eventToKey = {
      whatsapp_share_clicked: 'whatsapp',
      native_share_clicked: 'native',
      copy_link_clicked: 'copyLink',
      qr_opened: 'qr',
    }
    let totalActions = 0
    for (const row of byTypeRows) {
      const [eventName, actions] = row
      const key = eventToKey[eventName]
      const count = Number(actions)
      if (key) byType[key] = count
      totalActions += count
    }

    const roomsWithShareIntent = Number(totalRoomsRows?.[0]?.[0] ?? 0)

    return { totalActions, roomsWithShareIntent, byType }
  })
}

/**
 * Guest Room Reach = room_viewed events where is_host = false (host views
 * excluded). Best-effort/behavioral — see module doc: client-side, DNT/ad
 * blockers may suppress it, a reload can double-count. Never present as
 * "unique guests" and never use this as Core Activation (that's
 * Photo.uploadActorType = 'guest' in Postgres).
 */
export async function getGuestRoomReach(range) {
  const { since, until } = resolveRangeBounds(range)
  return withCache(['guest-room-reach', range], async () => {
    const rows = await runHogQLQuery(
      `SELECT count() AS views, count(DISTINCT properties.room_slug) AS rooms_reached
       FROM events
       WHERE event = '${GUEST_ROOM_VIEWED_EVENT}'
         AND properties.is_host = false
         AND timestamp >= toDateTime('${formatHogQLDateTime(since)}')
         AND timestamp < toDateTime('${formatHogQLDateTime(until)}')`,
      'guest_room_reach',
    )
    const views = Number(rows?.[0]?.[0] ?? 0)
    const roomsReached = Number(rows?.[0]?.[1] ?? 0)
    if (!Number.isFinite(views) || !Number.isFinite(roomsReached)) {
      throw new Error('getGuestRoomReach: malformed counts in PostHog response')
    }
    return { views, roomsReached }
  })
}

/** Combined V1 payload for the admin traffic metrics API route. */
export async function getTrafficMetrics(range) {
  const [visitors, daily, sharing, guestRoomReach] = await Promise.all([
    getMarketingVisitors(range),
    getDailyMarketingVisitors(range),
    getShareMetrics(range),
    getGuestRoomReach(range),
  ])
  return {
    visitors: { count: visitors.count, daily },
    sharing,
    guestRoomReach,
  }
}
