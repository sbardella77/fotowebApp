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
 */

export const PREMIUM_PLANS = new Set(['professional', 'business', 'pro'])
export const EVENT_PREMIUM_TIERS = new Set(['pro_event', 'wedding_pro'])

export function isPremiumPlan(plan) {
  return PREMIUM_PLANS.has(plan)
}

/**
 * Resolve the canonical effective plan string for an event.
 * Priority: account plan → event billingTier → unlock → free
 */
export function resolveEffectiveEventPlan({ billingTier, originalDownloadUnlocked, ownerPlan }) {
  if (isPremiumPlan(ownerPlan)) {
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
 *   canDownloadOriginal: boolean,
 *   canDownloadGallery: boolean,
 *   hasUnbrandedDownloads: boolean,
 *   hasPrivateDelivery: boolean,
 *   canUploadUnlimited: boolean,
 *   canCreateUnlimitedRooms: boolean,
 * }}
 */
export function resolveEffectiveEventAccessState({
  billingTier,
  originalDownloadUnlocked,
  ownerPlan,
}) {
  const accountPremium = isPremiumPlan(ownerPlan)
  const eventUpgraded = EVENT_PREMIUM_TIERS.has(billingTier)
  const originalUnlocked = !!originalDownloadUnlocked

  const isPremium = accountPremium || eventUpgraded || originalUnlocked
  const isFree = !isPremium

  const effectivePlan = resolveEffectiveEventPlan({ billingTier, originalDownloadUnlocked, ownerPlan })

  // Product feature flags
  const canDownloadOriginal = accountPremium || eventUpgraded || originalUnlocked
  const canDownloadGallery = accountPremium || eventUpgraded
  const hasUnbrandedDownloads = canDownloadOriginal
  const hasPrivateDelivery = billingTier === 'wedding_pro' || accountPremium
  const canUploadUnlimited = eventUpgraded || accountPremium
  const canCreateUnlimitedRooms = accountPremium

  return {
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
