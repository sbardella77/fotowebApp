import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')
function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

describe('P1.1 — Homepage links to Private Party via localizedPath (SEO Internal Linking V1)', () => {
  const source = readComponent('components/landing-page.jsx')

  it('UseCasePreview items include a locale-aware Private Party card', () => {
    expect(source).toContain("localizedPath(locale, '/private-party-photo-sharing')")
  })

  it('does not introduce a bare or cross-locale private-party link', () => {
    expect(source).not.toMatch(/href=["']\/private-party-photo-sharing["']/)
    expect(source).not.toMatch(/localizedPath\(['"][a-z]{2}['"],\s*['"]\/private-party-photo-sharing['"]\)/)
  })

  it('the other five existing use-case cards are still present (no regression)', () => {
    for (const path of [
      '/wedding-photo-sharing',
      '/birthday-photo-sharing',
      '/corporate-event-photo-sharing',
      '/for-wedding-photographers',
      '/for-event-planners',
    ]) {
      expect(source).toContain(`localizedPath(locale, '${path}')`)
    }
  })

  it.each(LOCALES)('%s has non-empty landing.privateParty / landing.privatePartyDesc', (locale) => {
    const l = dictionaries[locale].landing
    for (const key of ['privateParty', 'privatePartyDesc']) {
      expect(typeof l[key]).toBe('string')
      expect(l[key].length).toBeGreaterThan(0)
    }
  })
})

describe('P1.2 — Wedding landing links to Pricing via localizedPath (SEO Internal Linking V1)', () => {
  const source = readComponent('components/wedding-landing-page.jsx')

  it('has a locale-aware secondary CTA to Pricing', () => {
    expect(source).toContain("localizedPath(locale, '/pricing')")
    expect(source).toContain('{t.viewPricing}')
  })

  it('does not introduce a bare or cross-locale pricing link', () => {
    expect(source).not.toMatch(/href=["']\/pricing["']/)
    expect(source).not.toMatch(/localizedPath\(['"][a-z]{2}['"],\s*['"]\/pricing['"]\)/)
  })

  it('primary CTA (create-event form) is unchanged and still present', () => {
    expect(source).toContain('{t.finalCta}')
    expect(source).toContain('createEvent')
    expect(source).toContain('cta-primary')
  })

  it.each(LOCALES)('%s has a non-empty wedding.viewPricing', (locale) => {
    expect(typeof dictionaries[locale].wedding.viewPricing).toBe('string')
    expect(dictionaries[locale].wedding.viewPricing.length).toBeGreaterThan(0)
  })
})
