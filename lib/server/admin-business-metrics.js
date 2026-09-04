/**
 * SnapRooms — Admin Business Dashboard V1: Postgres analytics service.
 *
 * Authoritative product-state metrics (signups, event creation, Core
 * Activation, paid accounts) computed from Postgres via Prisma. PostHog
 * (traffic/sharing/guest-reach) is a separate concern — see
 * lib/server/admin-analytics-posthog.js and lib/server/admin-business-dashboard.js,
 * which combines both sources.
 *
 * Canonical aggregation timezone: UTC, via the same `resolveRangeBounds`
 * used by the PostHog adapter, so both sources are bounded identically.
 */

import { resolveRangeBounds } from '@/lib/server/admin-analytics-posthog'
import { resolveSubscriptionAccessState } from '@/lib/server/subscription-lifecycle'

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * The period immediately preceding [since, until) of equal length, used for
 * previous-period KPI comparisons (Phase 8).
 */
export function resolvePreviousRangeBounds(range, now = new Date()) {
  const { since, until } = resolveRangeBounds(range, now)
  const durationMs = until.getTime() - since.getTime()
  return { since: new Date(since.getTime() - durationMs), until: since }
}

/**
 * Safe period-over-period percentage change.
 *
 * previous=0, current=0  -> {value: 0, trend: 'flat'}
 * previous=0, current>0  -> {value: null, trend: 'new'}   (never a fake "Infinity%")
 * otherwise              -> {value: <one-decimal percent>, trend: 'up'|'down'|'flat'}
 */
export function computePercentageChange(current, previous) {
  if (previous === 0 && current === 0) {
    return { value: 0, trend: 'flat' }
  }
  if (previous === 0 && current > 0) {
    return { value: null, trend: 'new' }
  }
  const pct = ((current - previous) / previous) * 100
  const rounded = Math.round(pct * 10) / 10
  return { value: rounded, trend: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat' }
}

function withComparison(current, previous) {
  return { current, previous, percentageChange: computePercentageChange(current, previous) }
}

function bucketByUTCDate(dates) {
  const map = new Map()
  for (const date of dates) {
    if (!date) continue
    const key = formatDateOnly(date)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return map
}

/**
 * Zero-filled daily series over [since, until), matching the shape produced
 * by admin-analytics-posthog.js's buildDailyZeroFilledSeries.
 */
function buildDailySeries(since, until, countsByDate) {
  const series = []
  const cursor = new Date(since)
  while (cursor < until) {
    const dateKey = formatDateOnly(cursor)
    series.push({ date: dateKey, count: countsByDate.get(dateKey) || 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

/**
 * First-event-per-owner timestamps, across all time (not range-filtered) —
 * a single groupBy, reused to derive both the current and previous period
 * counts from one query. Prisma expresses this natively via `_min`, so no
 * raw SQL is needed here.
 */
async function loadOwnerFirstEventTimestamps(prisma) {
  const groups = await prisma.event.groupBy({
    by: ['ownerId'],
    where: { ownerId: { not: null } },
    _min: { createdAt: true },
  })
  return groups.map((g) => g._min.createdAt).filter(Boolean)
}

/**
 * First server-derived-guest-photo-per-owner timestamps, across all time.
 *
 * Photo has no direct ownerId, only eventId -> Event.ownerId, so this is two
 * steps: (1) groupBy Photo by eventId for guest-attributed uploads to get
 * each event's first guest photo, bounded to "events with >=1 guest photo"
 * (not total photo volume); (2) resolve those event ids to owners and reduce
 * to one earliest timestamp per owner in memory. Still zero raw SQL and zero
 * per-owner queries — two aggregate queries plus one bounded lookup.
 *
 * Historical NULL uploadActorType rows are never counted (they simply don't
 * match the `uploadActorType: 'guest'` filter) — see Photo model comment.
 */
async function loadOwnerFirstGuestPhotoTimestamps(prisma) {
  const guestPhotoEventGroups = await prisma.photo.groupBy({
    by: ['eventId'],
    where: { uploadActorType: 'guest' },
    _min: { createdAt: true },
  })

  if (guestPhotoEventGroups.length === 0) {
    return []
  }

  const eventIds = guestPhotoEventGroups.map((g) => g.eventId)
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds }, ownerId: { not: null } },
    select: { id: true, ownerId: true },
  })
  const eventIdToOwnerId = new Map(events.map((e) => [e.id, e.ownerId]))

  const ownerFirstGuestPhoto = new Map()
  for (const group of guestPhotoEventGroups) {
    const ownerId = eventIdToOwnerId.get(group.eventId)
    const at = group._min?.createdAt
    if (!ownerId || !at) continue
    const existing = ownerFirstGuestPhoto.get(ownerId)
    if (!existing || at < existing) {
      ownerFirstGuestPhoto.set(ownerId, at)
    }
  }

  return [...ownerFirstGuestPhoto.values()]
}

/**
 * Current total of accounts in an active paid/premium state, reusing the
 * single authoritative `resolveSubscriptionAccessState().accountPremiumActive`
 * definition (lib/server/subscription-lifecycle.js) rather than re-deriving
 * plan/status logic here. This is a snapshot (today's state), not scoped to
 * the selected date range — see admin-business-dashboard.js for why.
 *
 * Loads one column-projected row per Owner (a single query, not per-owner
 * queries) and evaluates the pure, already-tested function in memory. At
 * SnapRooms' current pre-100-customer scale this is the correct tradeoff:
 * it guarantees zero drift from the authoritative billing semantics, which
 * matters more here than the cost of one bounded table scan. Revisit if
 * Owner volume grows into the tens of thousands.
 */
async function countPaidAccounts(prisma) {
  const owners = await prisma.owner.findMany({
    select: {
      plan: true,
      subscriptionStatus: true,
      paymentFailedAt: true,
      subscriptionGraceUntil: true,
      subscriptionCanceledAt: true,
      subscriptionCancelAtPeriodEnd: true,
      subscriptionCurrentPeriodEnd: true,
      stripeSubscriptionId: true,
    },
  })
  return owners.filter((owner) => resolveSubscriptionAccessState(owner).accountPremiumActive).length
}

/**
 * Postgres-derived Admin Business Dashboard metrics for one range.
 *
 * @param {Object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {'7d'|'30d'|'90d'} params.range
 * @param {Date} [params.now]
 */
export async function getPostgresBusinessMetrics({ prisma, range, now = new Date() }) {
  const { since, until } = resolveRangeBounds(range, now)
  const { since: prevSince, until: prevUntil } = resolvePreviousRangeBounds(range, now)

  const [
    signupsCurrent,
    signupsPrevious,
    signupRows,
    eventsCurrent,
    eventsPrevious,
    eventRows,
    ownerFirstEventTimestamps,
    ownerFirstGuestPhotoTimestamps,
    paidAccounts,
  ] = await Promise.all([
    prisma.owner.count({ where: { createdAt: { gte: since, lt: until } } }),
    prisma.owner.count({ where: { createdAt: { gte: prevSince, lt: prevUntil } } }),
    prisma.owner.findMany({ where: { createdAt: { gte: since, lt: until } }, select: { createdAt: true } }),
    prisma.event.count({ where: { createdAt: { gte: since, lt: until } } }),
    prisma.event.count({ where: { createdAt: { gte: prevSince, lt: prevUntil } } }),
    prisma.event.findMany({ where: { createdAt: { gte: since, lt: until } }, select: { createdAt: true } }),
    loadOwnerFirstEventTimestamps(prisma),
    loadOwnerFirstGuestPhotoTimestamps(prisma),
    countPaidAccounts(prisma),
  ])

  const inCurrentRange = (d) => d >= since && d < until
  const inPreviousRange = (d) => d >= prevSince && d < prevUntil

  const firstEventsCurrent = ownerFirstEventTimestamps.filter(inCurrentRange).length
  const firstEventsPrevious = ownerFirstEventTimestamps.filter(inPreviousRange).length

  const coreActivatedCurrent = ownerFirstGuestPhotoTimestamps.filter(inCurrentRange).length
  const coreActivatedPrevious = ownerFirstGuestPhotoTimestamps.filter(inPreviousRange).length

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    previous: { since: prevSince.toISOString(), until: prevUntil.toISOString() },
    signups: withComparison(signupsCurrent, signupsPrevious),
    eventsCreated: withComparison(eventsCurrent, eventsPrevious),
    firstEvents: withComparison(firstEventsCurrent, firstEventsPrevious),
    coreActivatedOwners: withComparison(coreActivatedCurrent, coreActivatedPrevious),
    // Snapshot, intentionally not range-scoped — see countPaidAccounts().
    paidAccounts: { current: paidAccounts },
    trends: {
      signups: buildDailySeries(since, until, bucketByUTCDate(signupRows.map((r) => r.createdAt))),
      eventsCreated: buildDailySeries(since, until, bucketByUTCDate(eventRows.map((r) => r.createdAt))),
      coreActivation: buildDailySeries(
        since,
        until,
        bucketByUTCDate(ownerFirstGuestPhotoTimestamps.filter(inCurrentRange)),
      ),
    },
  }
}
