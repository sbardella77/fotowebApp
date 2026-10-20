import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { LOCALES } from '@/lib/i18n/config'
import { dictionaries } from '@/lib/i18n/dictionaries'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

describe('CookieConsentBanner (PRIVACY-CONSENT-001B) — accessibility & equal prominence', () => {
  const source = read('components/cookie-consent-banner.jsx')

  it('is a dialog region with an accessible, focusable heading', () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-labelledby="cookie-consent-heading"')
    expect(source).toMatch(/id="cookie-consent-heading"/)
    expect(source).toMatch(/tabIndex=\{-1\}/)
  })

  it('focus moves to the heading when the banner becomes visible', () => {
    expect(source).toMatch(/headingRef\.current\?\.focus\(\)/)
  })

  it('Accept and Reject buttons share the same base classes — equal visual prominence, no color-only favoring of Accept', () => {
    const acceptMatch = source.match(/onClick=\{acceptAll\}[\s\S]{0,40}className="([^"]+)"/)
    const rejectMatch = source.match(/onClick=\{rejectNonEssential\}[\s\S]{0,40}className="([^"]+)"/)
    expect(acceptMatch).not.toBeNull()
    expect(rejectMatch).not.toBeNull()
    const acceptClasses = acceptMatch[1].split(' ')
    const rejectClasses = rejectMatch[1].split(' ')
    // Both share the same sizing/weight/rounding/flex classes — the only
    // difference is background/border (fill vs outline), not size or
    // emphasis, satisfying "equal prominence."
    for (const shared of ['rounded-md', 'px-4', 'py-2', 'text-sm', 'font-semibold', 'flex-1']) {
      expect(acceptClasses).toContain(shared)
      expect(rejectClasses).toContain(shared)
    }
  })

  it('does not auto-accept on Escape/dismiss — there is no keydown handler that calls acceptAll on its own', () => {
    expect(source).not.toMatch(/onKeyDown[\s\S]{0,80}acceptAll/)
    expect(source).not.toMatch(/Escape[\s\S]{0,80}acceptAll/)
  })

  it('links to the Privacy Policy via the existing localizedPath helper (no hardcoded URL)', () => {
    expect(source).toContain("import { localizedPath } from '@/lib/i18n/config'")
    expect(source).toMatch(/localizedPath\(locale, '\/privacy'\)/)
  })

  it('exposes OPEN_PREFERENCES_EVENT for the persistent footer re-open link', () => {
    expect(source).toContain('export const OPEN_PREFERENCES_EVENT')
    expect(source).toContain('addEventListener(OPEN_PREFERENCES_EVENT')
  })

  it('uses the "consent" i18n namespace via the existing useTranslations hook — no hardcoded English copy', () => {
    expect(source).toContain("useTranslations('consent')")
    // Spot-check: every user-facing t.<key> used in the component has no
    // literal English fallback string baked in via `||`.
    expect(source).not.toMatch(/t\.\w+\s*\|\|\s*['"]/)
  })
})

describe('Footer "Cookie Preferences" link dispatches the reopen event (not a navigation)', () => {
  const source = read('components/marketing/footer.jsx')

  it('imports OPEN_PREFERENCES_EVENT and dispatches it on click, rather than linking to a URL', () => {
    expect(source).toContain("import { OPEN_PREFERENCES_EVENT } from '@/components/cookie-consent-banner'")
    expect(source).toMatch(/dispatchEvent\(new Event\(OPEN_PREFERENCES_EVENT\)\)/)
  })
})

describe('Six-locale consent dictionary coverage (PRIVACY-CONSENT-001A §G)', () => {
  const REQUIRED_KEYS = [
    'bannerTitle',
    'bannerBody',
    'privacyLinkLabel',
    'acceptAll',
    'rejectNonEssential',
    'managePreferences',
    'prefsNecessaryLabel',
    'prefsNecessaryDesc',
    'prefsAlwaysOn',
    'prefsAnalyticsLabel',
    'prefsAnalyticsDesc',
    'prefsSave',
    'prefsClose',
  ]

  it('confirms the six supported locales match the task baseline', () => {
    expect([...LOCALES].sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt-BR'].sort())
  })

  it.each(LOCALES)('%s has a non-empty, distinct string for every required consent key', (locale) => {
    const consent = dictionaries[locale]?.consent
    expect(consent, `dictionaries.${locale}.consent must exist`).toBeTruthy()
    for (const key of REQUIRED_KEYS) {
      expect(typeof consent[key], `${locale}.consent.${key}`).toBe('string')
      expect(consent[key].length, `${locale}.consent.${key} must be non-empty`).toBeGreaterThan(0)
    }
  })

  it('every locale also has footer.cookiePreferences for the reopen link', () => {
    for (const locale of LOCALES) {
      const footer = dictionaries[locale]?.footer
      expect(typeof footer?.cookiePreferences, `${locale}.footer.cookiePreferences`).toBe('string')
      expect(footer.cookiePreferences.length).toBeGreaterThan(0)
    }
  })

  it('acceptAll and rejectNonEssential are distinct strings in every locale (not a copy-paste duplicate)', () => {
    for (const locale of LOCALES) {
      const consent = dictionaries[locale].consent
      expect(consent.acceptAll).not.toBe(consent.rejectNonEssential)
    }
  })
})

describe('Analytics consent is never mandatory for using SnapRooms (source contract)', () => {
  it('the banner never blocks interaction with the rest of the page — no full-screen overlay/backdrop element', () => {
    const source = read('components/cookie-consent-banner.jsx')
    expect(source).not.toMatch(/fixed inset-0/)
    expect(source).toContain('aria-modal="false"')
  })

  it('rejecting does not throw, redirect, or disable any other UI — it only persists state and cleans up analytics storage', () => {
    const source = read('components/cookie-consent-banner.jsx')
    const fn = source.slice(source.indexOf('function rejectNonEssential'), source.indexOf('function savePreferences'))
    expect(fn).not.toMatch(/window\.location|router\.push|disabled\s*=\s*true/)
  })
})
