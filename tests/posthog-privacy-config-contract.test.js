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

describe('no out-of-scope code was touched (GEO-PRIVACY-003 validation rule 4)', () => {
  it('no Stripe, database, auth, or event-photo files appear in the diff against origin/main', () => {
    const { execSync } = require('child_process')
    // Compares the working tree (committed or not) against origin/main, so
    // this holds true whether or not the current changes are committed yet.
    const diff = execSync('git diff --name-only origin/main', { cwd: ROOT, encoding: 'utf8' })
    const files = diff.split('\n').filter(Boolean)
    const offenders = files.filter((f) =>
      /stripe|prisma|schema\.prisma|app\/api\/events|app\/event\/|app\/dashboard\/login|password/i.test(f)
    )
    expect(offenders).toEqual([])
  })
})
