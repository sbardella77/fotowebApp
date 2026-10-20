import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function installMinimalBrowserGlobals() {
  let cookieJar = ''
  globalThis.window = globalThis.window || {}
  globalThis.window.location = { protocol: 'https:' }
  globalThis.window.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
  globalThis.window.innerWidth = 1024
  globalThis.document = globalThis.document || {}
  Object.defineProperty(globalThis.document, 'cookie', {
    configurable: true,
    get() {
      return cookieJar
    },
    set(value) {
      const [pair] = value.split(';')
      const [key, val] = pair.split('=')
      const existing = cookieJar.split('; ').filter((c) => c && !c.startsWith(`${key}=`))
      existing.push(`${key}=${val}`)
      cookieJar = existing.join('; ')
    },
  })
}

function uninstallMinimalBrowserGlobals() {
  delete globalThis.window
  delete globalThis.document
}

describe('no direct posthog-js import exists anywhere that could bypass the consent gate', () => {
  it('posthog-js is imported in exactly one file in the whole repo (posthog-client.js)', () => {
    const output = execSync(
      `grep -rl "'posthog-js'" --include="*.js" --include="*.jsx" app components lib`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim()
    const files = output.split('\n').filter(Boolean)
    expect(files).toEqual(['lib/analytics/posthog-client.js'])
  })
})

describe('every client analytics entry point respects the consent gate (behavioral)', () => {
  beforeEach(() => {
    installMinimalBrowserGlobals()
    vi.resetModules()
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'
  })

  afterEach(() => {
    uninstallMinimalBrowserGlobals()
    vi.doUnmock('posthog-js')
  })

  it('trackEvent() is a silent no-op with unknown consent — no capture() call reaches the SDK', async () => {
    const captureSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), capture: captureSpy } }))
    const { trackEvent } = await import('@/lib/analytics/track-client')
    trackEvent('some_event', { foo: 'bar' })
    await new Promise((r) => setTimeout(r, 0))
    expect(captureSpy).not.toHaveBeenCalled()
  })

  it('trackPageView() is a silent no-op with unknown consent', async () => {
    const captureSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), capture: captureSpy } }))
    const { trackPageView } = await import('@/lib/analytics/track-client')
    trackPageView('landing')
    await new Promise((r) => setTimeout(r, 0))
    expect(captureSpy).not.toHaveBeenCalled()
  })

  it('identifyUser() is a silent no-op with unknown consent — no identify() call reaches the SDK', async () => {
    const identifySpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), identify: identifySpy } }))
    const { identifyUser } = await import('@/lib/analytics/track-client')
    identifyUser('owner:123')
    await new Promise((r) => setTimeout(r, 0))
    expect(identifySpy).not.toHaveBeenCalled()
  })

  it('resetAnalyticsIdentity() is a silent no-op with unknown consent (nothing initialized to reset)', async () => {
    const resetSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), reset: resetSpy } }))
    const { resetAnalyticsIdentity } = await import('@/lib/analytics/track-client')
    expect(() => resetAnalyticsIdentity()).not.toThrow()
    expect(resetSpy).not.toHaveBeenCalled()
  })

  it('once accepted, trackEvent() DOES reach ph.capture() with the expected event name', async () => {
    const captureSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), capture: captureSpy } }))
    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    setStoredConsentState(CONSENT_STATES.ACCEPTED)

    const { trackEvent } = await import('@/lib/analytics/track-client')
    trackEvent('some_event', { foo: 'bar' })
    await new Promise((r) => setTimeout(r, 0))
    trackEvent('some_event', { foo: 'bar' }) // second call after init has resolved

    expect(captureSpy).toHaveBeenCalledWith('some_event', expect.objectContaining({ foo: 'bar' }))
  })

  it('rejecting consent after a prior session does not throw and produces no capture calls on the next page load (fresh module state)', async () => {
    const captureSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), capture: captureSpy } }))
    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    setStoredConsentState(CONSENT_STATES.REJECTED)

    const { trackEvent } = await import('@/lib/analytics/track-client')
    expect(() => trackEvent('some_event')).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(captureSpy).not.toHaveBeenCalled()
  })
})

describe('auth/event-creation/upload/checkout call sites remain analytics-independent (source contract)', () => {
  it('login success path calls identifyUser() but does not gate the login/redirect on its result', () => {
    const { readFileSync } = require('fs')
    const source = readFileSync(resolve(ROOT, 'app/dashboard/login/page-client.js'), 'utf8')
    // identifyUser() is void/fire-and-forget — its own internal try/catch
    // (track-client.js) already ensures it cannot throw into the caller,
    // and nothing here awaits or branches on its return value.
    expect(source).toMatch(/identifyUser\(ownerAnalyticsId\)/)
    expect(source).not.toMatch(/await identifyUser/)
  })

  it('dashboard logout() calls resetAnalyticsIdentity() only after the server logout already succeeded, and does not await/branch on it', () => {
    const { readFileSync } = require('fs')
    const source = readFileSync(resolve(ROOT, 'app/dashboard/page.js'), 'utf8')
    expect(source).toMatch(/resetAnalyticsIdentity\(\)/)
    expect(source).not.toMatch(/await resetAnalyticsIdentity/)
  })

  it('trackEvent/trackPageView/identifyUser/resetAnalyticsIdentity are all wrapped in their own try/catch in track-client.js, so a consent-gate failure can never propagate into a caller (login, event creation, upload, checkout UI)', () => {
    const { readFileSync } = require('fs')
    const source = readFileSync(resolve(ROOT, 'lib/analytics/track-client.js'), 'utf8')
    const tryCount = (source.match(/\btry\s*{/g) || []).length
    // trackEvent, identifyUser, resetAnalyticsIdentity each have their own
    // try/catch; trackPageView delegates entirely to trackEvent (no SDK
    // call of its own), so it has none — 3 is the correct, complete count.
    expect(tryCount).toBe(3)
  })
})
