import { describe, it, expect } from 'vitest'
import { sanitizeAnalyticsProperties } from '@/lib/analytics/sanitize-url'

describe('sanitizeAnalyticsProperties (GEO-PRIVACY-003 data minimization)', () => {
  it('strips eventSlug from $current_url', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?eventSlug=abc123&from=dashboard' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('eventSlug')
    expect(out.$current_url).not.toContain('abc123')
  })

  it('strips eventSlug from $referrer', () => {
    const input = { $referrer: 'https://snaprooms.app/en/pricing?eventSlug=xyz789' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$referrer).not.toContain('eventSlug')
    expect(out.$referrer).not.toContain('xyz789')
  })

  it('preserves other, non-sensitive query params', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?eventSlug=abc123&from=dashboard&billing=annual&plan=professional' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).toContain('from=dashboard')
    expect(out.$current_url).toContain('billing=annual')
    expect(out.$current_url).toContain('plan=professional')
  })

  it('leaves a URL with no sensitive params completely unchanged', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?plan=professional' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).toBe(input.$current_url)
  })

  it('leaves non-URL-shaped properties untouched', () => {
    const input = { page_type: 'landing', variant: 'wedding', device_type: 'mobile' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out).toEqual(input)
  })

  it('does not mutate the original properties object', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?eventSlug=abc123' }
    const originalUrl = input.$current_url
    sanitizeAnalyticsProperties(input)
    expect(input.$current_url).toBe(originalUrl)
  })

  it('never throws on a malformed or empty URL value', () => {
    expect(() => sanitizeAnalyticsProperties({ $current_url: 'not a url at all' })).not.toThrow()
    expect(() => sanitizeAnalyticsProperties({ $current_url: '' })).not.toThrow()
    expect(() => sanitizeAnalyticsProperties({ $current_url: null })).not.toThrow()
    expect(() => sanitizeAnalyticsProperties({})).not.toThrow()
    expect(() => sanitizeAnalyticsProperties(null)).not.toThrow()
    expect(() => sanitizeAnalyticsProperties(undefined)).not.toThrow()
  })

  it('handles a malformed URL by returning it unchanged rather than guessing', () => {
    const input = { $current_url: 'not a url at all' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).toBe('not a url at all')
  })

  it('strips eventSlug even when it is not the only or first query param', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?from=dashboard&eventSlug=abc123&billing=annual' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('eventSlug')
    expect(out.$current_url).toContain('from=dashboard')
    expect(out.$current_url).toContain('billing=annual')
  })
})
