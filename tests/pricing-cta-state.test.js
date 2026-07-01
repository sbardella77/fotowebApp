import { describe, it, expect } from 'vitest'
import { resolvePricingCtaState } from '../lib/pricing-cta-state'

describe('resolvePricingCtaState', () => {
  it('authenticated + pro-event → upgrade from dashboard with helper', () => {
    const result = resolvePricingCtaState({ authenticated: true, intent: 'pro-event' })
    expect(result.labelKey).toBe('pricingUpgradeFromDashboard')
    expect(result.href).toBe('/dashboard')
    expect(result.helperKey).toBe('pricingChooseEventInDashboard')
  })

  it('authenticated + wedding-pro → upgrade from dashboard with helper', () => {
    const result = resolvePricingCtaState({ authenticated: true, intent: 'wedding-pro' })
    expect(result.labelKey).toBe('pricingUpgradeFromDashboard')
    expect(result.href).toBe('/dashboard')
    expect(result.helperKey).toBe('pricingChooseEventInDashboard')
  })

  it('authenticated + professional → start professional from dashboard', () => {
    const result = resolvePricingCtaState({ authenticated: true, intent: 'professional' })
    expect(result.labelKey).toBe('pricingStartProfessionalFromDashboard')
    expect(result.href).toBe('/dashboard?upgrade=professional&from=pricing')
    expect(result.helperKey).toBeUndefined()
  })

  it('authenticated + professional + annual billing → link to annual offer', () => {
    const result = resolvePricingCtaState({ authenticated: true, intent: 'professional', billingInterval: 'annual' })
    expect(result.labelKey).toBe('pricingStartProfessionalFromDashboard')
    expect(result.href).toBe('/dashboard?upgrade=professional&from=pricing&billing=annual')
    expect(result.helperKey).toBeUndefined()
  })

  it('authenticated + free → go to dashboard', () => {
    const result = resolvePricingCtaState({ authenticated: true, intent: 'free' })
    expect(result.labelKey).toBe('pricingGoToDashboard')
    expect(result.href).toBe('/dashboard')
  })

  it('anonymous + pro-event → sign in to upgrade with next param', () => {
    const result = resolvePricingCtaState({ authenticated: false, intent: 'pro-event' })
    expect(result.labelKey).toBe('pricingSignInToUpgrade')
    expect(result.href).toBe('/dashboard/login?next=%2Fpricing%3Fplan%3Dpro-event')
  })

  it('anonymous + wedding-pro → sign in to upgrade with next param', () => {
    const result = resolvePricingCtaState({ authenticated: false, intent: 'wedding-pro' })
    expect(result.labelKey).toBe('pricingSignInToUpgrade')
    expect(result.href).toBe('/dashboard/login?next=%2Fpricing%3Fplan%3Dwedding-pro')
  })

  it('anonymous + professional → sign in to upgrade with next param', () => {
    const result = resolvePricingCtaState({ authenticated: false, intent: 'professional' })
    expect(result.labelKey).toBe('pricingSignInToUpgrade')
    expect(result.href).toBe('/dashboard/login?next=%2Fpricing%3Fplan%3Dprofessional')
  })

  it('anonymous + free → create free room', () => {
    const result = resolvePricingCtaState({ authenticated: false, intent: 'free' })
    expect(result.labelKey).toBe('createFreeRoomBtn')
    expect(result.href).toBe('/')
  })

  it('business is auth-agnostic and links to mailto', () => {
    expect(resolvePricingCtaState({ authenticated: true, intent: 'business' })).toEqual({
      labelKey: 'contactSales',
      href: 'mailto:hello@snaprooms.app',
    })
    expect(resolvePricingCtaState({ authenticated: false, intent: 'business' })).toEqual({
      labelKey: 'contactSales',
      href: 'mailto:hello@snaprooms.app',
    })
  })
})
