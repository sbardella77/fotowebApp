/**
 * SnapRooms — Event retention policy resolver.
 *
 * Isomorphic: safe to import from both client and server code.
 *
 * Calculates the storage expiration for an event based on:
 *   - event billingTier
 *   - owner subscription plan
 *   - optional vault extension
 *   - archive lock
 *
 * Does NOT perform destructive actions. Pure calculation only.
 */

import { addDays, addMonths, differenceInDays, isAfter, isBefore, parseISO } from 'date-fns'

const EXPIRING_SOON_DAYS = 30

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = parseISO(value)
    if (isNaN(parsed.getTime())) return null
    return parsed
  }
  if (typeof value === 'number') return new Date(value)
  return null
}

function isPremiumPlan(plan) {
  return plan === 'professional' || plan === 'business' || plan === 'pro'
}

/**
 * Resolve the retention state for a single event.
 *
 * @param {Object} params
 * @param {Object} params.event
 * @param {string|null} params.ownerPlan
 * @param {string|Date|null} [params.ownerSubscriptionCanceledAt]
 * @param {Date} [params.now]
 * @returns {{
 *   retentionUntil: Date | null,
 *   isExpired: boolean,
 *   isExpiringSoon: boolean,
 *   coveredByVault: boolean,
 *   canExtend: boolean,
 *   policy: string,
 *   labelKey: string,
 *   gracePeriodActive: boolean,
 * }}
 */
export function resolveEventRetentionState({
  event,
  ownerPlan,
  ownerSubscriptionCanceledAt,
  now = new Date(),
}) {
  const createdAt = toDate(event?.createdAt)
  const vaultExtendedUntil = toDate(event?.vaultExtendedUntil)
  const gracePeriodUntil = toDate(event?.gracePeriodUntil)
  const archiveLocked = event?.archiveLocked === true

  // 1. Archive lock — excluded from cleanup, no expiration shown
  if (archiveLocked) {
    return {
      retentionUntil: null,
      isExpired: false,
      isExpiringSoon: false,
      coveredByVault: false,
      canExtend: false,
      policy: 'archived_locked',
      labelKey: 'storedWhileSubscriptionActive', // closest safe copy
      gracePeriodActive: false,
    }
  }

  // 2. Vault extension takes precedence over normal tiers
  if (vaultExtendedUntil && isAfter(vaultExtendedUntil, now)) {
    const expiringSoon = differenceInDays(vaultExtendedUntil, now) <= EXPIRING_SOON_DAYS
    return {
      retentionUntil: vaultExtendedUntil,
      isExpired: false,
      isExpiringSoon: expiringSoon,
      coveredByVault: true,
      canExtend: true,
      policy: 'vault_extended',
      labelKey: 'storedUntil',
      gracePeriodActive: false,
    }
  }

  // 3. Event-level premium tiers (one-time purchases)
  const billingTier = event?.billingTier
  if (billingTier === 'pro_event') {
    const until = createdAt ? addMonths(createdAt, 12) : null
    const expired = until ? isBefore(until, now) : false
    const expiringSoon = until && !expired ? differenceInDays(until, now) <= EXPIRING_SOON_DAYS : false
    return {
      retentionUntil: until,
      isExpired: expired,
      isExpiringSoon: expiringSoon,
      coveredByVault: false,
      canExtend: true,
      policy: 'pro_event_12_months',
      labelKey: 'storedUntil',
      gracePeriodActive: false,
    }
  }

  if (billingTier === 'wedding_pro') {
    const until = createdAt ? addMonths(createdAt, 24) : null
    const expired = until ? isBefore(until, now) : false
    const expiringSoon = until && !expired ? differenceInDays(until, now) <= EXPIRING_SOON_DAYS : false
    return {
      retentionUntil: until,
      isExpired: expired,
      isExpiringSoon: expiringSoon,
      coveredByVault: false,
      canExtend: true,
      policy: 'wedding_pro_24_months',
      labelKey: 'storedUntil',
      gracePeriodActive: false,
    }
  }

  // 4. Subscription-based professional / business
  if (isPremiumPlan(ownerPlan)) {
    return {
      retentionUntil: null,
      isExpired: false,
      isExpiringSoon: false,
      coveredByVault: false,
      canExtend: false,
      policy: 'professional_active',
      labelKey: 'storedWhileSubscriptionActive',
      gracePeriodActive: false,
    }
  }

  // 5. Grace period after subscription cancellation
  const canceledAt = toDate(ownerSubscriptionCanceledAt) || gracePeriodUntil
  if (canceledAt) {
    const until = addDays(canceledAt, 90)
    const expired = isBefore(until, now)
    const expiringSoon = !expired ? differenceInDays(until, now) <= EXPIRING_SOON_DAYS : false
    return {
      retentionUntil: until,
      isExpired: expired,
      isExpiringSoon: expiringSoon,
      coveredByVault: false,
      canExtend: true,
      policy: 'professional_grace_90_days',
      labelKey: 'storedUntil',
      gracePeriodActive: true,
    }
  }

  // 6. Free default — 90 days from creation
  const until = createdAt ? addDays(createdAt, 90) : null
  const expired = until ? isBefore(until, now) : false
  const expiringSoon = until && !expired ? differenceInDays(until, now) <= EXPIRING_SOON_DAYS : false
  return {
    retentionUntil: until,
    isExpired: expired,
    isExpiringSoon: expiringSoon,
    coveredByVault: false,
    canExtend: true,
    policy: 'free_90_days',
    labelKey: 'storedUntil',
    gracePeriodActive: false,
  }
}

/**
 * Server-side convenience that reads the owner record from Prisma
 * and returns the retention state enriched with owner context.
 *
 * @param {Object} prisma
 * @param {Object} event
 * @returns {Promise<Object>}
 */
export async function getEventRetentionStateFromDb(prisma, event) {
  let ownerPlan = null
  let ownerSubscriptionCanceledAt = null
  if (event?.ownerId && prisma) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true, subscriptionCanceledAt: true },
    })
    ownerPlan = owner?.plan || null
    ownerSubscriptionCanceledAt = owner?.subscriptionCanceledAt || null
  }
  return resolveEventRetentionState({ event, ownerPlan, ownerSubscriptionCanceledAt })
}
