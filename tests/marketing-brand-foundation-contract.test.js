import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const ALL_MARKETING_PAGES = [
  'components/landing-page.jsx',
  'components/wedding-landing-page.jsx',
  'components/photographers-landing-page.jsx',
  'components/planners-landing-page.jsx',
  'components/birthday-landing-page.jsx',
  'components/corporate-landing-page.jsx',
  'components/private-party-landing-page.jsx',
  'components/pricing-page.jsx',
  'components/privacy-page.jsx',
  'components/terms-page.jsx',
  'components/commercial-license-page.jsx',
]

describe('canonical logo is the single source of truth (Redesign V4, Phase 1)', () => {
  it('nav and footer import SnapRoomsLogo, not a hand-coded Camera icon lockup', () => {
    const nav = readComponent('components/marketing/nav.jsx')
    const footer = readComponent('components/marketing/footer.jsx')
    expect(nav).toContain("from '@/components/marketing/logo'")
    expect(footer).toContain("from '@/components/marketing/logo'")
    // The old hand-built lockup: an icon inside a bg-primary rounded box, next
    // to a hardcoded "SnapRooms" span. `Camera` may still appear elsewhere in
    // nav.jsx as a decorative icon (e.g. the "For Photographers" menu item).
    expect(nav).not.toMatch(/bg-primary text-primary-foreground[^>]*>\s*<Camera/)
    expect(footer).not.toContain('Camera')
    expect(nav).not.toContain('>SnapRooms<')
    expect(footer).not.toContain('>SnapRooms<')
  })
})

describe('no marketing page duplicates the nav/footer shell (Redesign V4, Phase 1)', () => {
  it.each(ALL_MARKETING_PAGES)('%s renders MarketingNav/MarketingFooter, not an inline <nav>/<footer>', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain('<MarketingNav')
    expect(source).toContain('<MarketingFooter')
    expect(source).not.toMatch(/<nav\s/)
    expect(source).not.toMatch(/<footer\s/)
  })

  it.each(ALL_MARKETING_PAGES)('%s has a valid #main-content skip-link target', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain('id="main-content"')
  })
})

describe('pages with their own #create form use ctaAction="scroll" (Redesign V4, Phase 1)', () => {
  const SCROLL_PAGES = [
    'components/landing-page.jsx',
    'components/wedding-landing-page.jsx',
    'components/photographers-landing-page.jsx',
    'components/planners-landing-page.jsx',
    'components/birthday-landing-page.jsx',
    'components/corporate-landing-page.jsx',
    'components/private-party-landing-page.jsx',
  ]
  const LINK_PAGES = [
    'components/pricing-page.jsx',
    'components/privacy-page.jsx',
    'components/terms-page.jsx',
    'components/commercial-license-page.jsx',
  ]

  it.each(SCROLL_PAGES)('%s passes ctaAction="scroll" and has id="create"', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain('<MarketingNav ctaAction="scroll" />')
    expect(source).toContain('id="create"')
  })

  it.each(LINK_PAGES)('%s passes ctaAction="link" (no local create-form)', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain('<MarketingNav ctaAction="link" />')
  })
})

describe('MarketingNav accessibility foundations (Redesign V4, Phase 1)', () => {
  const nav = readComponent('components/marketing/nav.jsx')

  it('renders a skip link targeting #main-content', () => {
    expect(nav).toContain('href="#main-content"')
  })

  it('renders a mobile Sheet menu with a labelled trigger', () => {
    expect(nav).toContain('SheetTrigger')
    expect(nav).toContain('SheetContent')
    expect(nav).toContain('aria-label={t.menu}')
  })

  it('marks the active nav link with aria-current', () => {
    expect(nav).toContain("aria-current={isHome ? 'page' : undefined}")
    expect(nav).toContain("aria-current={isPricing ? 'page' : undefined}")
  })

  it('never links to a fabricated /for-professionals or /blog route', () => {
    expect(nav).not.toContain("'/for-professionals'")
    expect(nav).not.toContain("'/blog'")
  })
})

describe('reduced-motion guard exists in globals.css (Redesign V4, Phase 1)', () => {
  const css = readComponent('app/globals.css')

  it('guards animation/transition duration under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-duration: 0.01ms !important')
  })
})

describe('new nav i18n keys are present for all locales (Redesign V4, Phase 1)', () => {
  it.each(LOCALES)('%s has non-empty nav.home, forProfessionals, skipToContent, menu', (locale) => {
    for (const key of ['home', 'forProfessionals', 'skipToContent', 'menu']) {
      expect(typeof dictionaries[locale].nav[key]).toBe('string')
      expect(dictionaries[locale].nav[key].length).toBeGreaterThan(0)
    }
  })
})

describe('no legacy border-white/[0.0X] opacity literals remain (Redesign V4, Phase 1)', () => {
  it.each(ALL_MARKETING_PAGES.concat(['components/install-cta.jsx']))('%s has no border-white/[0.0X] literal', (relPath) => {
    const source = readComponent(relPath)
    expect(source).not.toMatch(/border-white\/\[0\.\d+\]/)
  })
})
