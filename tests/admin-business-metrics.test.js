import { describe, it, expect, vi } from 'vitest'
import {
  getPostgresBusinessMetrics,
  computePercentageChange,
  resolvePreviousRangeBounds,
} from '@/lib/server/admin-business-metrics'

// Fixed reference "now" so range boundaries are deterministic:
//   current window:  [2026-08-29T00:00:00Z, 2026-09-05T00:00:00Z)
//   previous window: [2026-08-22T00:00:00Z, 2026-08-29T00:00:00Z)
const NOW = new Date('2026-09-04T12:00:00.000Z')
const CURRENT_SINCE = new Date('2026-08-29T00:00:00.000Z')
const PREVIOUS_SINCE = new Date('2026-08-22T00:00:00.000Z')

function makePrisma({
  ownerCountByWindow = { current: 0, previous: 0 },
  signupRows = [],
  eventCountByWindow = { current: 0, previous: 0 },
  eventRows = [],
  ownerFirstEventGroups = [],
  guestPhotoEventGroups = [],
  eventOwnerLookup = [],
  paidOwnerRows = [],
} = {}) {
  return {
    owner: {
      count: vi.fn(async ({ where }) => {
        const gte = where.createdAt.gte.getTime()
        if (gte === CURRENT_SINCE.getTime()) return ownerCountByWindow.current
        if (gte === PREVIOUS_SINCE.getTime()) return ownerCountByWindow.previous
        return 0 // a different range's window (e.g. 90d in the same test) — not under test here
      }),
      findMany: vi.fn(async (args) => (args?.where ? signupRows : paidOwnerRows)),
    },
    event: {
      count: vi.fn(async ({ where }) => {
        const gte = where.createdAt.gte.getTime()
        if (gte === CURRENT_SINCE.getTime()) return eventCountByWindow.current
        if (gte === PREVIOUS_SINCE.getTime()) return eventCountByWindow.previous
        return 0 // a different range's window (e.g. 90d in the same test) — not under test here
      }),
      findMany: vi.fn(async (args) => (args?.where?.id ? eventOwnerLookup : eventRows)),
      groupBy: vi.fn(async (args) => {
        expect(args.where).toEqual({ ownerId: { not: null } }) // ownerless events excluded at the query level
        return ownerFirstEventGroups
      }),
    },
    photo: {
      groupBy: vi.fn(async (args) => {
        expect(args.where).toEqual({ uploadActorType: 'guest' }) // owner + historical NULL rows excluded at the query level
        return guestPhotoEventGroups
      }),
    },
  }
}

describe('computePercentageChange', () => {
  it('previous=0, current=0 -> flat 0%, not NaN', () => {
    expect(computePercentageChange(0, 0)).toEqual({ value: 0, trend: 'flat' })
  })

  it('previous=0, current>0 -> "new", not a fabricated Infinity%', () => {
    expect(computePercentageChange(5, 0)).toEqual({ value: null, trend: 'new' })
  })

  it('normal increase', () => {
    expect(computePercentageChange(20, 10)).toEqual({ value: 100, trend: 'up' })
  })

  it('normal decrease', () => {
    expect(computePercentageChange(5, 10)).toEqual({ value: -50, trend: 'down' })
  })

  it('no change', () => {
    expect(computePercentageChange(10, 10)).toEqual({ value: 0, trend: 'flat' })
  })
})

describe('resolvePreviousRangeBounds', () => {
  it('returns the immediately-preceding window of equal length', () => {
    const { since, until } = resolvePreviousRangeBounds('7d', NOW)
    expect(since.toISOString()).toBe(PREVIOUS_SINCE.toISOString())
    expect(until.toISOString()).toBe(CURRENT_SINCE.toISOString())
  })
})

describe('getPostgresBusinessMetrics — Core Activation critical cases (Phase 27)', () => {
  it('a guest upload counts as Core Activation', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [{ eventId: 'evt-1', _min: { createdAt: new Date('2026-09-01T00:00:00.000Z') } }],
      eventOwnerLookup: [{ id: 'evt-1', ownerId: 'owner-1' }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(1)
  })

  it('owner upload only does not count (excluded at the query level via uploadActorType: "guest")', async () => {
    // photo.groupBy is mocked to only ever return guest-filtered rows (asserted
    // inside makePrisma); an owner-only event simply never appears here.
    const prisma = makePrisma({ guestPhotoEventGroups: [], eventOwnerLookup: [] })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(0)
  })

  it('historical NULL uploadActorType rows do not count (same exclusion as owner uploads)', async () => {
    const prisma = makePrisma({ guestPhotoEventGroups: [], eventOwnerLookup: [] })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(0)
    expect(prisma.photo.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { uploadActorType: 'guest' } }),
    )
  })

  it('multiple guest photos across multiple events for the same owner: owner is counted once, using the earliest timestamp', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [
        { eventId: 'evt-1', _min: { createdAt: new Date('2026-09-02T00:00:00.000Z') } },
        { eventId: 'evt-2', _min: { createdAt: new Date('2026-08-30T00:00:00.000Z') } }, // earlier
      ],
      eventOwnerLookup: [
        { id: 'evt-1', ownerId: 'owner-1' },
        { id: 'evt-2', ownerId: 'owner-1' },
      ],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    // Both events' first-guest-photo fall in the current window, but it's
    // the SAME owner across both events, so Core Activation counts them once.
    expect(result.coreActivatedOwners.current).toBe(1)
  })

  it('an ownerless event (ownerId null) creates no owner activation', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [{ eventId: 'evt-orphan', _min: { createdAt: new Date('2026-09-01T00:00:00.000Z') } }],
      eventOwnerLookup: [], // findMany's `ownerId: { not: null }` filter excludes the orphaned event
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(0)
  })

  it('a guest upload outside the selected range is excluded from the current-period count', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [{ eventId: 'evt-1', _min: { createdAt: new Date('2026-07-01T00:00:00.000Z') } }], // well before both windows
      eventOwnerLookup: [{ id: 'evt-1', ownerId: 'owner-1' }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(0)
    expect(result.coreActivatedOwners.previous).toBe(0)
  })

  it('a guest upload landing in the previous window (not current) is reflected in .previous, not .current', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [{ eventId: 'evt-1', _min: { createdAt: new Date('2026-08-25T00:00:00.000Z') } }],
      eventOwnerLookup: [{ id: 'evt-1', ownerId: 'owner-1' }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(0)
    expect(result.coreActivatedOwners.previous).toBe(1)
  })

  it('multiple owners activating independently are all counted', async () => {
    const prisma = makePrisma({
      guestPhotoEventGroups: [
        { eventId: 'evt-1', _min: { createdAt: new Date('2026-09-01T00:00:00.000Z') } },
        { eventId: 'evt-2', _min: { createdAt: new Date('2026-09-02T00:00:00.000Z') } },
      ],
      eventOwnerLookup: [
        { id: 'evt-1', ownerId: 'owner-1' },
        { id: 'evt-2', ownerId: 'owner-2' },
      ],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.coreActivatedOwners.current).toBe(2)
  })
})

describe('getPostgresBusinessMetrics — First Event', () => {
  it('excludes ownerless events at the query level', async () => {
    const prisma = makePrisma({ ownerFirstEventGroups: [] })
    await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(prisma.event.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: { not: null } } }),
    )
  })

  it('an owner with multiple events is counted once, on their first event only', async () => {
    const prisma = makePrisma({
      // Prisma's groupBy by ownerId with _min already yields one row per
      // owner — this row IS the owner's true first event.
      ownerFirstEventGroups: [{ ownerId: 'owner-1', _min: { createdAt: new Date('2026-09-01T00:00:00.000Z') } }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.firstEvents.current).toBe(1)
  })

  it('a first event outside the selected range is excluded', async () => {
    const prisma = makePrisma({
      ownerFirstEventGroups: [{ ownerId: 'owner-1', _min: { createdAt: new Date('2026-01-01T00:00:00.000Z') } }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.firstEvents.current).toBe(0)
    expect(result.firstEvents.previous).toBe(0)
  })
})

describe('getPostgresBusinessMetrics — Signups / Events Created / Paid Accounts', () => {
  it('signups and eventsCreated reflect Owner/Event.createdAt counts with period-over-period comparison', async () => {
    const prisma = makePrisma({
      ownerCountByWindow: { current: 10, previous: 4 },
      eventCountByWindow: { current: 8, previous: 2 },
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.signups).toEqual({ current: 10, previous: 4, percentageChange: { value: 150, trend: 'up' } })
    expect(result.eventsCreated).toEqual({ current: 8, previous: 2, percentageChange: { value: 300, trend: 'up' } })
  })

  it('paid accounts uses the authoritative accountPremiumActive definition, not plan alone', async () => {
    const prisma = makePrisma({
      paidOwnerRows: [
        // Active professional subscription -> paid.
        { plan: 'professional', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', paymentFailedAt: null, subscriptionGraceUntil: null, subscriptionCanceledAt: null, subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null },
        // Free plan -> not paid.
        { plan: 'free', subscriptionStatus: null, stripeSubscriptionId: null, paymentFailedAt: null, subscriptionGraceUntil: null, subscriptionCanceledAt: null, subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null },
        // Canceled subscription, no grace -> not paid.
        { plan: 'professional', subscriptionStatus: 'canceled', stripeSubscriptionId: null, paymentFailedAt: null, subscriptionGraceUntil: null, subscriptionCanceledAt: new Date('2026-08-01'), subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null },
        // Legacy professional with no subscriptionStatus at all -> paid (accountPremiumActive treats this as active).
        { plan: 'professional', subscriptionStatus: null, stripeSubscriptionId: null, paymentFailedAt: null, subscriptionGraceUntil: null, subscriptionCanceledAt: null, subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null },
      ],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.paidAccounts).toEqual({ current: 2 })
  })

  it('paid accounts is a current snapshot, not filtered by the selected date range', async () => {
    const prisma = makePrisma({
      paidOwnerRows: [
        { plan: 'professional', subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', paymentFailedAt: null, subscriptionGraceUntil: null, subscriptionCanceledAt: null, subscriptionCancelAtPeriodEnd: false, subscriptionCurrentPeriodEnd: null },
      ],
    })
    const result7d = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    const result90d = await getPostgresBusinessMetrics({ prisma, range: '90d', now: NOW })
    expect(result7d.paidAccounts.current).toBe(result90d.paidAccounts.current)
  })
})

describe('getPostgresBusinessMetrics — trends', () => {
  it('daily signup trend is zero-filled across the full window, not sparse', async () => {
    const prisma = makePrisma({
      signupRows: [{ createdAt: new Date('2026-09-01T10:00:00.000Z') }],
    })
    const result = await getPostgresBusinessMetrics({ prisma, range: '7d', now: NOW })
    expect(result.trends.signups).toHaveLength(7) // 7d window -> 7 daily buckets
    const nonZero = result.trends.signups.filter((d) => d.count > 0)
    expect(nonZero).toEqual([{ date: '2026-09-01', count: 1 }])
    expect(result.trends.signups.every((d) => d.count >= 0)).toBe(true)
  })
})
