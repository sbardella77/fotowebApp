import { describe, it, expect } from 'vitest'
import { resolveDashboardExperience, DASHBOARD_AUDIENCES } from '@/lib/dashboard-experience'

describe('resolveDashboardExperience', () => {
  it('free account with no events shows consumer experience and Free account badge', () => {
    const experience = resolveDashboardExperience({ plan: 'free', events: [] })
    expect(experience.audience).toBe(DASHBOARD_AUDIENCES.CONSUMER)
    expect(experience.planBadge.label).toBe('Free')
    expect(experience.planBadge.variant).toBe('free')
    expect(experience.primaryCta).toBe('create_event')
    expect(experience.header.ctaKey).toBe('createNewEvent')
  })

  it('free account with a Pro Event still shows Free account badge', () => {
    const experience = resolveDashboardExperience({
      plan: 'free',
      events: [{ id: '1', billingTier: 'pro_event' }],
    })
    expect(experience.audience).toBe(DASHBOARD_AUDIENCES.EVENT_PRO)
    expect(experience.planBadge.label).toBe('Free')
    expect(experience.primaryCta).toBe('create_event')
    expect(experience.header.ctaKey).toBe('createNewEvent')
  })

  it('free account with a Wedding Pro event still shows Free account badge', () => {
    const experience = resolveDashboardExperience({
      plan: 'free',
      events: [{ id: '1', billingTier: 'wedding_pro' }],
    })
    expect(experience.audience).toBe(DASHBOARD_AUDIENCES.WEDDING_PRO)
    expect(experience.planBadge.label).toBe('Free')
    expect(experience.primaryCta).toBe('create_event')
    expect(experience.header.ctaKey).toBe('createNewEvent')
  })

  it('professional account shows Professional badge and create-event primary CTA', () => {
    const experience = resolveDashboardExperience({
      plan: 'professional',
      events: [{ id: '1', billingTier: 'wedding_pro' }],
    })
    expect(experience.audience).toBe(DASHBOARD_AUDIENCES.PROFESSIONAL)
    expect(experience.planBadge.label).toBe('Professional')
    expect(experience.planBadge.variant).toBe('premium')
    expect(experience.primaryCta).toBe('create_event')
    expect(experience.header.ctaKey).toBe('createNewEvent')
  })

  it('business account shows Business badge', () => {
    const experience = resolveDashboardExperience({
      plan: 'business',
      events: [{ id: '1', billingTier: 'pro_event' }],
    })
    expect(experience.audience).toBe(DASHBOARD_AUDIENCES.PROFESSIONAL)
    expect(experience.planBadge.label).toBe('Business')
  })

  it('legacy pro account shows Pro badge', () => {
    const experience = resolveDashboardExperience({
      plan: 'pro',
      events: [{ id: '1', billingTier: 'wedding_pro' }],
    })
    expect(experience.planBadge.label).toBe('Pro')
  })

  it('never uses manage_delivery as the global primary CTA', () => {
    const weddingProExperience = resolveDashboardExperience({
      plan: 'free',
      events: [{ id: '1', billingTier: 'wedding_pro' }],
    })
    expect(weddingProExperience.primaryCta).not.toBe('manage_delivery')
    expect(weddingProExperience.header.ctaKey).toBe('createNewEvent')
  })
})
