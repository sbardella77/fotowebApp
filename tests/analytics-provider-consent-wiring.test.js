import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

describe('AnalyticsProvider (PRIVACY-CONSENT-001B) — SSR/hydration/navigation safety', () => {
  const source = read('components/analytics-provider.jsx')

  it("is a 'use client' component (never runs during server rendering)", () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('initializes only inside useEffect — React effects never run during SSR, only after hydration', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*initPostHog\(\)\s*\}, \[\]\)/)
  })

  it('has an empty dependency array — does not re-fire on every render/route change', () => {
    expect(source).toMatch(/\}, \[\]\)/)
  })

  it('does not itself read cookies or branch on consent — delegates entirely to initPostHog() (single source of truth)', () => {
    expect(source).not.toContain('document.cookie')
    expect(source).not.toContain('isConsentAccepted')
  })
})

describe('Root layout wiring (app/layout.js)', () => {
  const source = read('app/layout.js')

  it('mounts both AnalyticsProvider and CookieConsentBanner inside I18nProvider (so the banner can use useTranslations)', () => {
    const i18nBlock = source.slice(source.indexOf('<I18nProvider'), source.indexOf('</I18nProvider>'))
    expect(i18nBlock).toContain('<AnalyticsProvider>')
    expect(i18nBlock).toContain('<CookieConsentBanner')
  })

  it('imports CookieConsentBanner', () => {
    expect(source).toContain("import { CookieConsentBanner } from '@/components/cookie-consent-banner'")
  })
})

describe('Locale changes do not themselves trigger re-initialization or re-consent', () => {
  it('lib/consent/cookie.js consent cookie is independent of NEXT_LOCALE — different cookie name, never read/written together', () => {
    const cookieSource = read('lib/consent/cookie.js')
    const i18nConfigSource = read('lib/i18n/config.js')
    expect(cookieSource).not.toContain('NEXT_LOCALE')
    expect(i18nConfigSource).not.toContain('snaprooms_cookie_consent')
  })
})

describe('Consent cookie cannot be confused with auth state or a server-trusted signal (security boundary)', () => {
  it('the consent cookie name is distinct from both existing session cookie names', () => {
    const cookieSource = read('lib/consent/state.js')
    expect(cookieSource).toContain("'snaprooms_cookie_consent'")
    expect(cookieSource).not.toContain('snaprooms_owner_session')
    expect(cookieSource).not.toContain('event_gallery_admin_session')
  })

  it('no server-side route file reads the consent cookie — it is a client-only, non-authoritative signal (PRIVACY-CONSENT-001B rule 33/34)', () => {
    const { execSync } = require('child_process')
    const output = execSync('grep -rl "snaprooms_cookie_consent" app/api lib/server 2>/dev/null || true', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(output).toBe('')
  })
})
