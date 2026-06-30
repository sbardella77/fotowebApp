/**
 * SnapRooms — Product-oriented effective event access state.
 *
 * Single source of truth for interpreting an event's premium capabilities.
 * Isomorphic: safe to import from both client and server code.
 *
 * Consumes:
 *   - billingTier           (event-level: 'pro_event' | 'wedding_pro' | null)
 *   - originalDownloadUnlocked (one-time unlock boolean)
 *   - ownerPlan             (account-level: 'free' | 'professional' | 'business' | 'pro')
 *
 * Returns a flat, product-oriented state object used by:
 *   - Dashboard badges & CTAs
 *   - Event page messaging
 *   - Download logic (watermark, gallery ZIP)
 *   - Upgrade prompts
 *
 * RULE: No new premium feature should read billingTier, ownerPlan, or
 * originalDownloadUnlocked directly if it can consume this function instead.
 *
 * Edge case — originalDownloadUnlocked = true:
 *   - Single-photo download is unbranded (hasUnbrandedDownloads = true)
 *   - Gallery ZIP is NOT enabled (canDownloadGallery = false)
 *   - Premium badge is NOT shown (badge logic uses accountPremium || eventUpgraded)
 *   - Private delivery is NOT enabled (hasPrivateDelivery = false)
 *
 * Scenario quick reference:
 *   Free + Free event          → isFree, no badge, watermark, gallery blocked
 *   Free + Pro Event           → eventUpgraded, "Pro Event" badge, no watermark, gallery ok
 *   Free + Wedding Pro         → eventUpgraded, "Wedding Pro" badge, private delivery ok
 *   Professional + Free event  → accountPremium, "Premium active" badge, all features ok
 *   originalDownloadUnlocked   → originalUnlocked, no badge, unbranded single photo only
 */

export const PREMIUM_PLANS = new Set(['professional', 'business', 'pro'])
export const EVENT_PREMIUM_TIERS = new Set(['pro_event', 'wedding_pro'])

export function isPremiumPlan(plan) {
  return PREMIUM_PLANS.has(plan)
}

const ACTIVE_STATUSES = new Set(['active', 'trialing'])
const GRACE_STATUSES = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired'])

function isDateInFuture(date) {
  if (!date) return false
  return new Date(date) > new Date()
}

/**
 * Determine whether an owner is effectively premium, considering Stripe
 * subscription status and any active payment grace period.
 */
export function isEffectivePremiumActive({
  plan,
  subscriptionStatus,
  subscriptionGraceUntil,
}) {
  if (!isPremiumPlan(plan)) return false

  // Legacy owners without explicit Stripe status are treated as active.
  if (!subscriptionStatus) return true

  if (ACTIVE_STATUSES.has(subscriptionStatus)) return true

  if (GRACE_STATUSES.has(subscriptionStatus) && isDateInFuture(subscriptionGraceUntil)) {
    return true
  }

  return false
}

/**
 * Resolve the canonical effective plan string for an event.
 * Priority: account plan → event billingTier → unlock → free
 */
export function resolveEffectiveEventPlan({
  billingTier,
  originalDownloadUnlocked,
  ownerPlan,
  subscriptionStatus,
  subscriptionGraceUntil,
}) {
  const accountPremium = isEffectivePremiumActive({
    plan: ownerPlan,
    subscriptionStatus,
    subscriptionGraceUntil,
  })

  if (accountPremium) {
    return ownerPlan
  }
  if (billingTier) {
    return billingTier
  }
  if (originalDownloadUnlocked) {
    return 'unlocked'
  }
  return 'free'
}

/**
 * Resolve the complete product-oriented access state for an event.
 *
 * @param {Object} params
 * @param {string|null} params.billingTier
 * @param {boolean}     params.originalDownloadUnlocked
 * @param {string|null} params.ownerPlan
 * @returns {{
 *   accountPremium: boolean,
 *   eventUpgraded: boolean,
 *   originalUnlocked: boolean,
 *   isPremium: boolean,
 *   isFree: boolean,
 *   effectivePlan: string,
 *   billingTier: string|null,
 *   canDownloadOriginal: boolean,
 *   canDownloadGallery: boolean,
 *   hasUnbrandedDownloads: boolean,
 *   hasPrivateDelivery: boolean,
 *   canUploadUnlimited: boolean,
 *   canCreateUnlimitedRooms: boolean,
 * }}
 *
 * Feature flag rules:
 *   canDownloadOriginal    = accountPremium || eventUpgraded || originalUnlocked
 *   canDownloadGallery     = accountPremium || eventUpgraded
 *   hasUnbrandedDownloads  = canDownloadOriginal
 *   hasPrivateDelivery     = billingTier === 'wedding_pro' || accountPremium
 *   canUploadUnlimited     = eventUpgraded || accountPremium
 *   canCreateUnlimitedRooms= accountPremium
 *
 * Important: isPremium includes originalUnlocked, but badge logic should use
 * (accountPremium || eventUpgraded) so that originalDownloadUnlocked alone
 * does not render a premium badge.
 */
export function resolveEffectiveEventAccessState({
  billingTier,
  originalDownloadUnlocked,
  ownerPlan,
  subscriptionStatus,
  subscriptionGraceUntil,
  subscriptionCanceledAt,
}) {
  const accountPremium = isEffectivePremiumActive({
    plan: ownerPlan,
    subscriptionStatus,
    subscriptionGraceUntil,
  })
  const eventUpgraded = EVENT_PREMIUM_TIERS.has(billingTier)
  const originalUnlocked = !!originalDownloadUnlocked

  const isPremium = accountPremium || eventUpgraded || originalUnlocked
  const isFree = !isPremium

  const effectivePlan = resolveEffectiveEventPlan({
    billingTier,
    originalDownloadUnlocked,
    ownerPlan,
    subscriptionStatus,
    subscriptionGraceUntil,
  })

  // Product feature flags
  const canDownloadOriginal = accountPremium || eventUpgraded || originalUnlocked
  const canDownloadGallery = accountPremium || eventUpgraded
  const hasUnbrandedDownloads = canDownloadOriginal
  const hasPrivateDelivery = billingTier === 'wedding_pro' || accountPremium
  const canUploadUnlimited = eventUpgraded || accountPremium
  const canCreateUnlimitedRooms = accountPremium

  return {
    billingTier,
    accountPremium,
    eventUpgraded,
    originalUnlocked,
    isPremium,
    isFree,
    effectivePlan,

    canDownloadOriginal,
    canDownloadGallery,
    hasUnbrandedDownloads,
    hasPrivateDelivery,
    canUploadUnlimited,
    canCreateUnlimitedRooms,
  }
}
