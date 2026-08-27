import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')
function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

describe('landing page renders the new sections (Redesign V4, Phase 2)', () => {
  const source = readComponent('components/landing-page.jsx')

  it('renders ProblemSection and UseCasePreview, not the old gradient-only UseCaseCards', () => {
    expect(source).toContain('<ProblemSection')
    expect(source).toContain('<UseCasePreview')
    expect(source).not.toContain('UseCaseCards')
  })

  it('links every use-case card to a real localizedPath destination', () => {
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

  it('renders InstallCta exactly once (via MarketingFooter, not duplicated inline)', () => {
    const matches = source.match(/InstallCta/g) || []
    expect(matches.length).toBe(0) // landing-page.jsx itself should have zero references now
  })
})

describe('wedding-landing-page.jsx no longer duplicates InstallCta either', () => {
  it('has no inline InstallCta call (MarketingFooter already renders it)', () => {
    const source = readComponent('components/wedding-landing-page.jsx')
    expect(source).not.toContain('InstallCta')
  })
})

describe('PhoneMockup uses real images, not gradient placeholders (Redesign V4, Phase 2)', () => {
  const source = readComponent('components/marketing/phone-mockup.jsx')

  it('imports next/image and has no gradient-tile photo placeholders', () => {
    expect(source).toContain("from 'next/image'")
    expect(source).not.toMatch(/bg-gradient-to-br from-\w+-\d+ to-\w+-\d+/)
  })

  it('default photos resolve to files that actually exist under public/', () => {
    const matches = [...source.matchAll(/\/marketing-placeholder\/[\w-]+\.jpg/g)].map((m) => m[0])
    expect(matches.length).toBeGreaterThan(0)
    for (const src of matches) {
      const filePath = resolve(ROOT, 'public' + src)
      expect(existsSync(filePath), `missing asset: ${src}`).toBe(true)
    }
  })
})

describe('UseCasePreview card images exist on disk', () => {
  it('every photoSrc referenced in landing-page.jsx exists under public/', () => {
    const source = readComponent('components/landing-page.jsx')
    const matches = [...source.matchAll(/photoSrc:\s*'([^']+)'/g)].map((m) => m[1])
    expect(matches.length).toBe(5)
    for (const src of matches) {
      const filePath = resolve(ROOT, 'public' + src)
      expect(existsSync(filePath), `missing asset: ${src}`).toBe(true)
    }
  })
})

describe('how-it-works.jsx step label is localized, not hardcoded "Step" (Redesign V4, Phase 2)', () => {
  it('uses t.stepLabel instead of a literal "Step" string', () => {
    const source = readComponent('components/marketing/how-it-works.jsx')
    expect(source).toContain('t?.stepLabel')
    expect(source).not.toMatch(/>\s*Step \{step\.num\}/)
  })

  it.each(LOCALES)('%s has a non-empty landing.stepLabel', (locale) => {
    expect(typeof dictionaries[locale].landing.stepLabel).toBe('string')
    expect(dictionaries[locale].landing.stepLabel.length).toBeGreaterThan(0)
  })
})

describe('footer link labels resolve to real i18n values, not undefined (Redesign V4, Phase 2 fix)', () => {
  const source = readComponent('components/marketing/footer.jsx')

  it('references t.forPhotographers/t.forPlanners, not the nonexistent t.photographers/t.planners', () => {
    expect(source).toContain('{t.forPhotographers}')
    expect(source).toContain('{t.forPlanners}')
    expect(source).not.toContain('{t.photographers}')
    expect(source).not.toContain('{t.planners}')
  })

  it('links to the previously-orphaned /private-party-photo-sharing page', () => {
    expect(source).toContain("localizedPath(locale, '/private-party-photo-sharing')")
  })

  it.each(LOCALES)('%s footer namespace has non-empty weddings/birthdays/corporate/privateParty', (locale) => {
    const f = dictionaries[locale].footer
    for (const key of ['weddings', 'birthdays', 'corporate', 'privateParty', 'forPhotographers', 'forPlanners']) {
      expect(typeof f[key]).toBe('string')
      expect(f[key].length).toBeGreaterThan(0)
    }
  })
})

describe('updated hero/final-CTA copy present for all locales (Redesign V4, Phase 2)', () => {
  it.each(LOCALES)('%s has non-empty headline1/headline2/subheadline/finalTitle/finalDesc', (locale) => {
    const l = dictionaries[locale].landing
    for (const key of ['headline1', 'headline2', 'subheadline', 'finalTitle', 'finalDesc', 'photographersCardDesc', 'plannersCardDesc']) {
      expect(typeof l[key]).toBe('string')
      expect(l[key].length).toBeGreaterThan(0)
    }
  })
})

describe('home-page-client.jsx redirect state uses the canonical logo (Redesign V4, Phase 2 fix)', () => {
  it('no longer references the raw legacy snaprooms-logo.svg asset', () => {
    const source = readComponent('components/home-page-client.jsx')
    expect(source).not.toContain('snaprooms-logo.svg')
    expect(source).toContain("from '@/components/marketing/logo'")
  })
})
