import { resolveEffectiveEventAccessState } from '@/lib/event-access'

/**
 * Resolve the effective status label for an event,
 * taking into account both account-level plan and event-level billingTier.
 */
export function getEffectiveEventStatus({ event, plan, t }) {
  const state = resolveEffectiveEventAccessState({
    billingTier: event?.billingTier || null,
    originalDownloadUnlocked: event?.originalDownloadUnlocked,
    ownerPlan: plan || null,
  })

  if (state.accountPremium) {
    return t.premiumActive ?? 'Premium active'
  }
  if (state.eventUpgraded) {
    return event.billingTier === 'wedding_pro' ? t.weddingPro : t.proEvent
  }
  return t.free ?? 'Free'
}

/**
 * Resolve the effective tier label for a premium badge/pill.
 * Returns null when the event is effectively free and the account is not premium.
 */
export function getEffectiveEventTierLabel({ event, plan, t }) {
  const state = resolveEffectiveEventAccessState({
    billingTier: event?.billingTier || null,
    originalDownloadUnlocked: event?.originalDownloadUnlocked,
    ownerPlan: plan || null,
  })

  if (state.accountPremium) {
    return t.premiumActive ?? 'Premium active'
  }
  if (state.eventUpgraded) {
    return event.billingTier === 'wedding_pro' ? t.weddingPro : t.proEvent
  }
  return null
}
