import { describe, it, expect } from 'vitest'
import { normalizePricingPlanParam } from '../lib/pricing-deep-link'

describe('normalizePricingPlanParam', () => {
  it('Guest Room legacy underscore form normalizes to the canonical hyphenated tier id', () => {
    expect(normalizePricingPlanParam('pro_event')).toBe('pro-event')
  })

  it('canonical hyphenated form passes through unchanged', () => {
    expect(normalizePricingPlanParam('pro-event')).toBe('pro-event')
  })

  it('other legitimate tier ids pass through unchanged', () => {
    expect(normalizePricingPlanParam('wedding-pro')).toBe('wedding-pro')
    expect(normalizePricingPlanParam('professional')).toBe('professional')
    expect(normalizePricingPlanParam('free')).toBe('free')
    expect(normalizePricingPlanParam('business')).toBe('business')
  })

  it('missing/empty param returns null', () => {
    expect(normalizePricingPlanParam(null)).toBeNull()
    expect(normalizePricingPlanParam(undefined)).toBeNull()
    expect(normalizePricingPlanParam('')).toBeNull()
  })
})
