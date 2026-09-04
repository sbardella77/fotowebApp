/**
 * SnapRooms — Admin Business Dashboard V1: cross-source orchestrator.
 *
 * Combines the Postgres analytics service (lib/server/admin-business-metrics.js,
 * authoritative product-state) with the existing PostHog read adapter
 * (lib/server/admin-analytics-posthog.js, traffic/sharing/guest-reach) into
 * one normalized, aggregate-only response for GET /api/admin/metrics/business.
 *
 * Postgres and PostHog have different reliability profiles: a PostHog
 * failure must never blank out the (authoritative, DB-backed) product
 * metrics. "Unavailable" (the query failed) is kept strictly distinct from
 * "zero" (the query succeeded and found nothing) throughout this module —
 * unavailable fields are `null`, never 0.
 */

import { getTrafficMetrics } from '@/lib/server/admin-analytics-posthog'
import { PostHogQueryError } from '@/lib/server/posthog-query'
import { getPostgresBusinessMetrics } from '@/lib/server/admin-business-metrics'

const FUNNEL_STAGES = [
  { key: 'visitors', label: 'Visitors' },
  { key: 'signups', label: 'Signups' },
  { key: 'firstEvents', label: 'First Event' },
  { key: 'coreActivated', label: 'Core Activation' },
  { key: 'paid', label: 'Paid' },
]

function safeConversionRate(numerator, denominator) {
  if (numerator == null || denominator == null || !denominator) {
    return null
  }
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * Ordered funnel stages with each stage's conversion rate from the stage
 * immediately before it. A `null` count (PostHog unavailable) or a zero
 * denominator both safely produce `null` here, never NaN/Infinity — the UI
 * renders `null` as "—".
 *
 * This is a Business/Stage Funnel over the same date window, not a strict
 * person-level cohort funnel: PostHog visitor identity is not reliably
 * linked to a specific signed-up Owner, so "Visitor -> Signup" is a
 * volume-over-volume ratio within the period, not "this visitor became this
 * owner." Surfaced to the caller via `funnel.isStageFunnel` so the UI can
 * label and explain it rather than implying strict identity linkage.
 */
export function computeFunnel(counts) {
  const stages = FUNNEL_STAGES.map(({ key, label }) => ({ key, label, count: counts[key] ?? null }))
  return stages.map((stage, index) => ({
    ...stage,
    conversionFromPrevious: index === 0 ? null : safeConversionRate(stage.count, stages[index - 1].count),
  }))
}

function mapPostHogUnavailableReason(error) {
  if (error instanceof PostHogQueryError) {
    return error.category
  }
  return 'QUERY_FAILED'
}

/**
 * Build the full Admin Business Dashboard V1 response for one range.
 *
 * @param {Object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {'7d'|'30d'|'90d'} params.range
 * @param {Date} [params.now]
 */
export async function getAdminBusinessMetrics({ prisma, range, now = new Date() }) {
  const postgres = await getPostgresBusinessMetrics({ prisma, range, now })

  let postHog
  let postHogStatus
  try {
    postHog = await getTrafficMetrics(range)
    postHogStatus = { status: 'ok' }
  } catch (error) {
    postHog = null
    postHogStatus = { status: 'unavailable', reason: mapPostHogUnavailableReason(error) }
  }

  // Visitors currently has no previous-period comparison: getTrafficMetrics
  // only resolves bounds against "now", and issuing a second live PostHog
  // query per dashboard load purely to decorate one KPI card with a delta
  // is not justified for V1 given PostHog's observed query latency
  // variability. Tracked as a deliberate follow-up, not an oversight.
  const visitorsCount = postHog ? postHog.visitors.count : null

  const funnel = computeFunnel({
    visitors: visitorsCount,
    signups: postgres.signups.current,
    firstEvents: postgres.firstEvents.current,
    coreActivated: postgres.coreActivatedOwners.current,
    paid: postgres.paidAccounts.current,
  })

  return {
    range,
    generatedAt: now.toISOString(),
    since: postgres.since,
    until: postgres.until,
    previous: postgres.previous,
    postHog: postHogStatus,

    acquisition: {
      visitors: { current: visitorsCount },
      signups: postgres.signups,
    },
    activation: {
      eventsCreated: postgres.eventsCreated,
      firstEvents: postgres.firstEvents,
      coreActivatedOwners: postgres.coreActivatedOwners,
    },
    engagement: postHog
      ? {
          roomsWithShareIntent: postHog.sharing.roomsWithShareIntent,
          shareActions: postHog.sharing.totalActions,
          roomsReached: postHog.guestRoomReach.roomsReached,
          guestRoomViews: postHog.guestRoomReach.views,
        }
      : {
          roomsWithShareIntent: null,
          shareActions: null,
          roomsReached: null,
          guestRoomViews: null,
        },
    // Snapshot as of "now" — not scoped to the selected range. See
    // admin-business-metrics.js's countPaidAccounts() for why.
    monetization: {
      paidAccounts: postgres.paidAccounts.current,
    },

    // Business/Stage Funnel, not a strict person-level cohort funnel — see
    // computeFunnel() doc comment above.
    funnel: {
      isStageFunnel: true,
      stages: funnel,
    },

    trends: {
      visitors: postHog ? postHog.visitors.daily : null,
      signups: postgres.trends.signups,
      eventsCreated: postgres.trends.eventsCreated,
      coreActivation: postgres.trends.coreActivation,
    },
  }
}
