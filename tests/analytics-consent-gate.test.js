import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

/**
 * This repo has no jsdom dependency and no existing test uses one — the
 * established convention (confirmed across every analytics test file in
 * this project) is source-inspection + pure-function testing. For the
 * handful of genuinely behavioral assertions below (does initPostHog()
 * actually import the SDK or not), a minimal, hand-rolled document/window
 * stub is used instead of adding a new jsdom dependency — scoped tightly
 * to just a cookie jar and localStorage, which is all this module touches.
 */
function installMinimalBrowserGlobals() {
  let cookieJar = ''
  const store = new Map()

  globalThis.window = globalThis.window || {}
  globalThis.window.location = { protocol: 'https:' }
  globalThis.window.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }

  globalThis.document = globalThis.document || {}
  Object.defineProperty(globalThis.document, 'cookie', {
    configurable: true,
    get() {
      return cookieJar
    },
    set(value) {
      const [pair] = value.split(';')
      const [key, val] = pair.split('=')
      if (value.includes('max-age=0')) {
        cookieJar = cookieJar
          .split('; ')
          .filter((c) => !c.startsWith(`${key}=`))
          .join('; ')
        return
      }
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

describe('posthog-client.js / track-client.js — consent gating (source contract)', () => {
  const posthogClientSource = read('lib/analytics/posthog-client.js')
  const trackClientSource = read('lib/analytics/track-client.js')

  it('initPostHog() checks isConsentAccepted() before ever touching the SDK', () => {
    expect(posthogClientSource).toContain("import { isConsentAccepted } from '@/lib/consent/cookie'")
    expect(posthogClientSource).toMatch(/if \(!isConsentAccepted\(\)\) return/)
  })

  it("posthog-js is imported dynamically (not statically) — the SDK is never fetched before consent", () => {
    expect(posthogClientSource).not.toMatch(/^import posthog from ['"]posthog-js['"]/m)
    expect(posthogClientSource).toContain("import('posthog-js')")
  })

  it('getPostHog() returns the cached instance only if initialized AND still consented — never the raw SDK unconditionally', () => {
    expect(posthogClientSource).toMatch(/if \(!initialized\) return null/)
    expect(posthogClientSource).toMatch(/if \(!isConsentAccepted\(\)\) return null/)
  })

  it('withdrawal calls opt_out_capturing(), never reset() — documented rationale present', () => {
    expect(posthogClientSource).toContain('opt_out_capturing()')
    expect(posthogClientSource).not.toMatch(/cachedPostHog\.reset\(\)/)
    expect(posthogClientSource).toMatch(/does NOT call posthog\.reset\(\)/)
  })

  it('withdrawal cleanup only ever targets the ph_<token>_posthog persistence key — never a cookie/localStorage key by a different name', () => {
    expect(posthogClientSource).toMatch(/`ph_\$\{POSTHOG_KEY\}_posthog`/)
  })

  it('track-client.js still has the `if (!ph) return` short-circuit on every entry point (the actual enforcement point)', () => {
    const guardCount = (trackClientSource.match(/if \(!ph\) return/g) || []).length
    expect(guardCount).toBeGreaterThanOrEqual(2) // trackEvent + identifyUser, at minimum
  })

  it('trackPageView is implemented purely in terms of trackEvent (inherits the same gate, no separate SDK call)', () => {
    expect(trackClientSource).toMatch(/export function trackPageView[\s\S]{0,100}trackEvent\(/)
  })
})

describe('posthog-client.js — behavioral: SDK is never loaded while not accepted', () => {
  beforeEach(() => {
    installMinimalBrowserGlobals()
    vi.resetModules()
  })

  afterEach(() => {
    uninstallMinimalBrowserGlobals()
    vi.doUnmock('posthog-js')
  })

  it('initPostHog() never imports posthog-js when consent is unknown/rejected', async () => {
    const initSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: initSpy } }))
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'

    const { initPostHog, getPostHog } = await import('@/lib/analytics/posthog-client')
    await initPostHog()

    expect(initSpy).not.toHaveBeenCalled()
    expect(getPostHog()).toBeNull()
  })

  it('initPostHog() DOES load and call posthog.init() once consent is accepted', async () => {
    const initSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: initSpy } }))
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'

    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    setStoredConsentState(CONSENT_STATES.ACCEPTED)

    const { initPostHog, getPostHog } = await import('@/lib/analytics/posthog-client')
    await initPostHog()

    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(getPostHog()).not.toBeNull()
  })

  it('withdrawConsentAndCleanup() calls opt_out_capturing on the cached instance and clears the persistence key, without regenerating any id', async () => {
    const optOutSpy = vi.fn()
    const initSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: initSpy, opt_out_capturing: optOutSpy } }))
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'

    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    setStoredConsentState(CONSENT_STATES.ACCEPTED)

    const { initPostHog, withdrawConsentAndCleanup, getPostHog } = await import('@/lib/analytics/posthog-client')
    await initPostHog()
    expect(getPostHog()).not.toBeNull()

    window.localStorage.setItem('ph_phc_test_key_posthog', '{"distinct_id":"abc"}')
    withdrawConsentAndCleanup()

    expect(optOutSpy).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('ph_phc_test_key_posthog')).toBeNull()
    // getPostHog() must now be null again, since `initialized` was reset
    expect(getPostHog()).toBeNull()
  })

  it('withdrawal never touches the consent cookie itself, the locale cookie, or auth session cookies', async () => {
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), opt_out_capturing: vi.fn() } }))
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'

    document.cookie = 'NEXT_LOCALE=en'
    document.cookie = 'snaprooms_owner_session=sometoken'

    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    const { CONSENT_COOKIE_NAME } = await import('@/lib/consent/state')
    setStoredConsentState(CONSENT_STATES.ACCEPTED)

    const { initPostHog, withdrawConsentAndCleanup } = await import('@/lib/analytics/posthog-client')
    await initPostHog()
    withdrawConsentAndCleanup()

    expect(document.cookie).toContain('NEXT_LOCALE=en')
    expect(document.cookie).toContain('snaprooms_owner_session=sometoken')
    expect(document.cookie).toContain(`${CONSENT_COOKIE_NAME}=`)
  })

  it('no pre-consent event is ever queued/buffered — rejecting then later accepting starts clean, nothing from the rejected period is replayed', async () => {
    const initSpy = vi.fn()
    vi.doMock('posthog-js', () => ({ default: { init: initSpy } }))
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'

    const { setStoredConsentState, CONSENT_STATES } = await import('@/lib/consent/cookie')
    const { initPostHog, getPostHog } = await import('@/lib/analytics/posthog-client')

    // Unknown state: calling initPostHog() (as track-client.js's trackEvent does
    // on every call) must be a complete no-op — nothing is queued for later.
    await initPostHog()
    expect(initSpy).not.toHaveBeenCalled()

    setStoredConsentState(CONSENT_STATES.ACCEPTED)
    await initPostHog()
    // Exactly one init call (from after acceptance) — proves nothing from
    // the pre-consent period was queued and flushed on acceptance.
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(getPostHog()).not.toBeNull()
  })
})
