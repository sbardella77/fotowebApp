import { describe, it, expect } from 'vitest'
import { resolveAllUpsells, getProEventUpsell, getWeddingProUpsell } from '@/lib/upsell-context'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'

function state(billingTier, ownerPlan = 'free') {
  return resolveEffectiveEventAccessState({
    billingTier,
    originalDownloadUnlocked: false,
    ownerPlan,
  })
}

describe('resolveAllUpsells event upgrade logic', () => {
  it('free event on free account offers Pro Event and Wedding Pro upgrades', () => {
    const upsells = resolveAllUpsells(state(null, 'free'))
    expect(upsells.some((u) => u.feature === 'pro_event_upgrade')).toBe(true)
    expect(upsells.some((u) => u.feature === 'wedding_pro_upgrade')).toBe(true)
  })

  it('pro_event event on free account offers only Wedding Pro upgrade', () => {
    const upsells = resolveAllUpsells(state('pro_event', 'free'))
    expect(upsells.some((u) => u.feature === 'pro_event_upgrade')).toBe(false)
    expect(upsells.some((u) => u.feature === 'wedding_pro_upgrade')).toBe(true)
  })

  it('wedding_pro event on free account offers no event-level upgrades', () => {
    const upsells = resolveAllUpsells(state('wedding_pro', 'free'))
    expect(upsells.some((u) => u.feature === 'pro_event_upgrade')).toBe(false)
    expect(upsells.some((u) => u.feature === 'wedding_pro_upgrade')).toBe(false)
  })

  it('professional account offers no event-level upgrades for any event', () => {
    for (const billingTier of [null, 'pro_event', 'wedding_pro']) {
      const upsells = resolveAllUpsells(state(billingTier, 'professional'))
      expect(upsells.some((u) => u.feature === 'pro_event_upgrade')).toBe(false)
      expect(upsells.some((u) => u.feature === 'wedding_pro_upgrade')).toBe(false)
    }
  })
})

describe('getWeddingProUpsell', () => {
  it('returns null for an already Wedding Pro event', () => {
    expect(getWeddingProUpsell(state('wedding_pro', 'free'))).toBeNull()
  })

  it('returns null for a professional account', () => {
    expect(getWeddingProUpsell(state('pro_event', 'professional'))).toBeNull()
  })

  it('uses upgradeToWeddingPro CTA when event is already Pro Event', () => {
    const upsell = getWeddingProUpsell(state('pro_event', 'free'))
    expect(upsell).not.toBeNull()
    expect(upsell.ctaKey).toBe('upgradeToWeddingPro')
  })

  it('uses chooseWeddingPro CTA when event is free', () => {
    const upsell = getWeddingProUpsell(state(null, 'free'))
    expect(upsell).not.toBeNull()
    expect(upsell.ctaKey).toBe('chooseWeddingPro')
  })
})

describe('getProEventUpsell', () => {
  it('returns null for an already Pro Event', () => {
    expect(getProEventUpsell(state('pro_event', 'free'))).toBeNull()
  })

  it('returns null for a Wedding Pro event', () => {
    expect(getProEventUpsell(state('wedding_pro', 'free'))).toBeNull()
  })

  it('returns null for a professional account', () => {
    expect(getProEventUpsell(state(null, 'professional'))).toBeNull()
  })

  it('returns an upsell for a free event on a free account', () => {
    expect(getProEventUpsell(state(null, 'free'))).not.toBeNull()
  })
})
