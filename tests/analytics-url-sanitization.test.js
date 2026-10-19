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

describe('$initial_referrer sanitization (GEO-PRIVACY-003C)', () => {
  it('strips eventSlug from $initial_referrer, the same way as $referrer', () => {
    const input = { $initial_referrer: 'https://snaprooms.app/en/pricing?eventSlug=abc123&from=dashboard' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$initial_referrer).not.toContain('eventSlug')
    expect(out.$initial_referrer).not.toContain('abc123')
    expect(out.$initial_referrer).toContain('from=dashboard')
  })

  it('leaves $initial_referring_domain completely untouched (hostname only, nothing to strip)', () => {
    const input = { $initial_referring_domain: 'perplexity.ai' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$initial_referring_domain).toBe('perplexity.ai')
  })

  it('sanitizes $current_url, $referrer, and $initial_referrer together in a single call, independently', () => {
    const input = {
      $current_url: 'https://snaprooms.app/en/pricing?eventSlug=curr',
      $referrer: 'https://snaprooms.app/en?eventSlug=ref',
      $initial_referrer: 'https://snaprooms.app/en/wedding-photo-sharing?eventSlug=init',
      $initial_referring_domain: 'google.com',
    }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('eventSlug')
    expect(out.$referrer).not.toContain('eventSlug')
    expect(out.$initial_referrer).not.toContain('eventSlug')
    expect(out.$initial_referring_domain).toBe('google.com')
  })
})

describe('$set_once attribution-bundle sanitization (posthog-js calls sanitize_properties a second time for this, per the installed SDK trace)', () => {
  it('sanitizes a flat $set_once-shaped properties bag the same way as a regular event — confirms one sanitizer covers both pipelines', () => {
    // This mirrors the exact shape posthog-js's get_initial_props()/
    // getSetOnceProps() builds internally before calling
    // sanitize_properties(bundle, "$set_once").
    const setOnceBundle = {
      $initial_referrer: 'https://snaprooms.app/en/pricing?eventSlug=first-touch-slug',
      $initial_referring_domain: 'chatgpt.com',
      $initial_current_url: 'https://snaprooms.app/en/pricing?eventSlug=first-touch-slug',
    }
    const out = sanitizeAnalyticsProperties(setOnceBundle)
    expect(out.$initial_referrer).not.toContain('eventSlug')
    expect(out.$initial_referring_domain).toBe('chatgpt.com')
    // $initial_current_url is not one of the two confirmed-populated keys
    // from the traced SDK (get_initial_props only produces $initial_referrer
    // and $initial_referring_domain), so it is intentionally left alone here
    // — asserting that explicitly rather than silently relying on it.
    expect(out.$initial_current_url).toBe(setOnceBundle.$initial_current_url)
  })
})

describe('repeated and encoded eventSlug handling (GEO-PRIVACY-003C)', () => {
  it('strips every instance of a repeated eventSlug param, not just the first', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?eventSlug=first&eventSlug=second&from=dashboard' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('eventSlug')
    expect(out.$current_url).not.toContain('first')
    expect(out.$current_url).not.toContain('second')
    expect(out.$current_url).toContain('from=dashboard')
  })

  it('strips a percent-encoded eventSlug value regardless of its encoded form', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?eventSlug=abc%20123%2Fxyz&from=dashboard' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('eventSlug')
    expect(out.$current_url).not.toContain('abc')
    expect(out.$current_url).not.toContain('xyz')
    expect(out.$current_url).toContain('from=dashboard')
  })

  it('strips eventSlug when the key name itself arrives percent-encoded (%65%76%65%6E%74%53%6C%75%67)', () => {
    const input = { $current_url: 'https://snaprooms.app/en/pricing?%65%76%65%6E%74%53%6C%75%67=abc123&from=dashboard' }
    const out = sanitizeAnalyticsProperties(input)
    expect(out.$current_url).not.toContain('abc123')
    expect(out.$current_url).toContain('from=dashboard')
  })
})
