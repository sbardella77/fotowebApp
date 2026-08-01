import { describe, it, expect } from 'vitest'
import { isEffectivePremiumActive, resolveEffectiveEventAccessState, resolveEffectiveEventPlan } from '@/lib/event-access'

describe('resolveEffectiveEventAccessState', () => {
  // ── SCENARIO A: FREE ──
  it('free event + free owner → all gates closed', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: false,
      ownerPlan: null,
    })

    expect(state.isFree).toBe(true)
    expect(state.isPremium).toBe(false)
    expect(state.accountPremium).toBe(false)
    expect(state.eventUpgraded).toBe(false)
    expect(state.originalUnlocked).toBe(false)
    expect(state.canDownloadOriginal).toBe(false)
    expect(state.hasUnbrandedDownloads).toBe(false)
    expect(state.canDownloadGallery).toBe(false)
    expect(state.hasPrivateDelivery).toBe(false)
    expect(state.canUploadUnlimited).toBe(false)
    expect(state.canCreateUnlimitedRooms).toBe(false)
    expect(state.effectivePlan).toBe('free')
  })

  // ── SCENARIO B: PRO EVENT ──
  it('pro_event upgrade → gallery + unbranded, no private delivery', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: 'pro_event',
      originalDownloadUnlocked: false,
      ownerPlan: null,
    })

    expect(state.isPremium).toBe(true)
    expect(state.eventUpgraded).toBe(true)
    expect(state.accountPremium).toBe(false)
    expect(state.canDownloadOriginal).toBe(true)
    expect(state.hasUnbrandedDownloads).toBe(true)
    expect(state.canDownloadGallery).toBe(true)
    expect(state.canUploadUnlimited).toBe(true)
    expect(state.hasPrivateDelivery).toBe(false)
    expect(state.canCreateUnlimitedRooms).toBe(false)
    expect(state.effectivePlan).toBe('pro_event')
  })

  // ── SCENARIO C: WEDDING PRO ──
  it('wedding_pro upgrade → everything + private delivery', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: 'wedding_pro',
      originalDownloadUnlocked: false,
      ownerPlan: null,
    })

    expect(state.isPremium).toBe(true)
    expect(state.eventUpgraded).toBe(true)
    expect(state.accountPremium).toBe(false)
    expect(state.canDownloadOriginal).toBe(true)
    expect(state.hasUnbrandedDownloads).toBe(true)
    expect(state.canDownloadGallery).toBe(true)
    expect(state.canUploadUnlimited).toBe(true)
    expect(state.hasPrivateDelivery).toBe(true)
    expect(state.canCreateUnlimitedRooms).toBe(false)
    expect(state.effectivePlan).toBe('wedding_pro')
  })

  // ── SCENARIO D: PROFESSIONAL ACCOUNT ──
  it('professional owner → all features for every event', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: false,
      ownerPlan: 'professional',
    })

    expect(state.isPremium).toBe(true)
    expect(state.accountPremium).toBe(true)
    expect(state.eventUpgraded).toBe(false)
    expect(state.canDownloadOriginal).toBe(true)
    expect(state.hasUnbrandedDownloads).toBe(true)
    expect(state.canDownloadGallery).toBe(true)
    expect(state.canUploadUnlimited).toBe(true)
    expect(state.hasPrivateDelivery).toBe(true)
    expect(state.canCreateUnlimitedRooms).toBe(true)
    expect(state.effectivePlan).toBe('professional')
  })

  it('business owner → treated as premium', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: false,
      ownerPlan: 'business',
    })

    expect(state.accountPremium).toBe(true)
    expect(state.isPremium).toBe(true)
    expect(state.canCreateUnlimitedRooms).toBe(true)
    expect(state.hasPrivateDelivery).toBe(true)
    expect(state.effectivePlan).toBe('business')
  })

  it('legacy "pro" owner → treated as premium', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: false,
      ownerPlan: 'pro',
    })

    expect(state.accountPremium).toBe(true)
    expect(state.isPremium).toBe(true)
    expect(state.canCreateUnlimitedRooms).toBe(true)
    expect(state.effectivePlan).toBe('pro')
  })

  // ── SCENARIO E: originalDownloadUnlocked ONLY ──
  it('originalDownloadUnlocked alone → single photo unbranded, no gallery, no badge', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: true,
      ownerPlan: null,
    })

    expect(state.isPremium).toBe(true)
    expect(state.isFree).toBe(false)
    expect(state.originalUnlocked).toBe(true)
    expect(state.accountPremium).toBe(false)
    expect(state.eventUpgraded).toBe(false)
    expect(state.canDownloadOriginal).toBe(true)
    expect(state.hasUnbrandedDownloads).toBe(true)
    expect(state.canDownloadGallery).toBe(false)
    expect(state.hasPrivateDelivery).toBe(false)
    expect(state.canUploadUnlimited).toBe(false)
    expect(state.canCreateUnlimitedRooms).toBe(false)
    expect(state.effectivePlan).toBe('unlocked')
  })

  // ── EDGE: Professional owner + event already upgraded ──
  it('professional owner + pro_event event → still professional plan', () => {
    const state = resolveEffectiveEventAccessState({
      billingTier: 'pro_event',
      originalDownloadUnlocked: false,
      ownerPlan: 'professional',
    })

    expect(state.accountPremium).toBe(true)
    expect(state.eventUpgraded).toBe(true)
    expect(state.effectivePlan).toBe('professional')
    expect(state.canCreateUnlimitedRooms).toBe(true)
  })
})

describe('resolveEffectiveEventPlan', () => {
  it('prioritises ownerPlan over billingTier', () => {
    expect(
      resolveEffectiveEventPlan({ billingTier: 'wedding_pro', originalDownloadUnlocked: true, ownerPlan: 'professional' })
    ).toBe('professional')
  })

  it('falls back to billingTier when no ownerPlan', () => {
    expect(
      resolveEffectiveEventPlan({ billingTier: 'wedding_pro', originalDownloadUnlocked: false, ownerPlan: null })
    ).toBe('wedding_pro')
  })

  it('falls back to unlocked when no billingTier', () => {
    expect(
      resolveEffectiveEventPlan({ billingTier: null, originalDownloadUnlocked: true, ownerPlan: null })
    ).toBe('unlocked')
  })

  it('defaults to free', () => {
    expect(
      resolveEffectiveEventPlan({ billingTier: null, originalDownloadUnlocked: false, ownerPlan: null })
    ).toBe('free')
  })
})

describe('isEffectivePremiumActive scheduled cancellation', () => {
  it('keeps premium active until current period end when cancellation is scheduled', () => {
    expect(
      isEffectivePremiumActive({
        plan: 'professional',
        subscriptionStatus: 'active',
        subscriptionCancelAtPeriodEnd: true,
        subscriptionCurrentPeriodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      })
    ).toBe(true)
  })

  it('is not premium after current period end expires', () => {
    expect(
      isEffectivePremiumActive({
        plan: 'professional',
        subscriptionStatus: 'active',
        subscriptionCancelAtPeriodEnd: true,
        subscriptionCurrentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
      })
    ).toBe(false)
  })
})
