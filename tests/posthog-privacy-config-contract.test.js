import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

describe('PostHog privacy-minimization config contract (GEO-PRIVACY-003)', () => {
  const source = read('lib/analytics/posthog-client.js')

  it('autocapture is explicitly disabled, not left at the SDK default', () => {
    expect(source).toMatch(/autocapture:\s*false/)
  })

  it('Session Replay is explicitly disabled client-side, independent of the project dashboard toggle', () => {
    expect(source).toMatch(/disable_session_recording:\s*true/)
  })

  it('sanitize_properties is wired to the shared URL sanitizer', () => {
    expect(source).toContain("import { sanitizeAnalyticsProperties } from './sanitize-url'")
    expect(source).toMatch(/sanitize_properties:\s*\(properties\)\s*=>\s*sanitizeAnalyticsProperties\(properties\)/)
  })

  it('previously-reviewed privacy controls remain unchanged', () => {
    expect(source).toMatch(/capture_pageview:\s*false/)
    expect(source).toMatch(/respect_dnt:\s*true/)
  })

  it('persistence mode is left untouched — no persistence key was added without DPO approval', () => {
    expect(source).not.toMatch(/\bpersistence\s*:/)
  })

  it('no first-touch or additional person properties were introduced', () => {
    expect(source).not.toMatch(/people\.set_once|register_once|first_touch/i)
  })

  it('no consent/opt-in/opt-out behavior was added', () => {
    expect(source).not.toMatch(/opt_in_capturing|opt_out_capturing|has_opted_in|has_opted_out/)
  })
})

describe('PostHog hook integration contract (GEO-PRIVACY-003C)', () => {
  const source = read('lib/analytics/posthog-client.js')

  it('retains sanitize_properties rather than migrating to before_send, with the decision documented', () => {
    expect(source).toContain('sanitize_properties:')
    expect(source).not.toMatch(/\bbefore_send\s*:/)
    expect(source).toMatch(/deprecat/i)
    expect(source).toMatch(/\$set_once/)
  })

  it('the sanitizer module now also covers $initial_referrer', () => {
    const sanitizeSource = read('lib/analytics/sanitize-url.js')
    expect(sanitizeSource).toContain('$initial_referrer')
    expect(sanitizeSource).toContain('$current_url')
    expect(sanitizeSource).toContain('$referrer')
  })

  it('$initial_referring_domain is explicitly documented as intentionally untouched, not silently omitted', () => {
    const sanitizeSource = read('lib/analytics/sanitize-url.js')
    expect(sanitizeSource).toMatch(/\$initial_referring_domain[\s\S]{0,400}(hostname|NOT)/i)
  })
})

describe('explicit funnel tracking call sites are unchanged (GEO-PRIVACY-003 must not affect measurement)', () => {
  const source = read('lib/analytics/track-client.js')

  it('trackEvent, identifyUser, resetAnalyticsIdentity, and trackPageView are all still exported with their existing signatures', () => {
    expect(source).toContain('export function trackEvent(eventName, properties = {})')
    expect(source).toContain('export function identifyUser(distinctId, properties = {})')
    expect(source).toContain('export function resetAnalyticsIdentity()')
    expect(source).toContain('export function trackPageView(pageType, properties = {})')
  })

  it('trackEvent still calls ph.capture unchanged — not rerouted through a new abstraction', () => {
    expect(source).toContain('ph.capture(eventName, props)')
  })
})

// Release-scope validation (GEO-PRIVACY-003 validation rule 4) previously lived
// here as a `git diff --name-only origin/main` check, but that ref is not
// guaranteed to exist in every checkout (e.g. GitHub Actions' default clone).
// It now runs as a pre-merge CI step (scripts/check-pr-release-scope.mjs)
// against the GitHub API's authoritative PR changed-files list instead.
