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

  it.each(LOCALES)('%s has a non-empty nav.signIn and nav.dashboard label', (locale) => {
    for (const key of ['signIn', 'dashboard']) {
      expect(typeof dictionaries[locale].nav[key]).toBe('string')
      expect(dictionaries[locale].nav[key].length).toBeGreaterThan(0)
    }
  })
})

describe('owner sign-in is reachable from the mobile header (P1 mobile UX fix)', () => {
  const navActions = readComponent('components/auth-aware-nav-actions.jsx')
  const nav = readComponent('components/marketing/nav.jsx')

  it('1/6. the header renders a sign-in control for every width below `sm`, not gated behind a bare "hidden" class', () => {
    // The old bug: the only sign-in button was `hidden ... sm:inline-flex`,
    // i.e. invisible at every width below `sm`. There must now be a second,
    // `sm:hidden` control that is the mobile-visible counterpart.
    expect(navActions).toMatch(/href="\/dashboard\/login"[\s\S]{0,400}sm:hidden|sm:hidden[\s\S]{0,400}href="\/dashboard\/login"/)
    const signInLinkCount = (navActions.match(/href="\/dashboard\/login"/g) || []).length
    expect(signInLinkCount).toBeGreaterThanOrEqual(2) // mobile icon control + desktop text control
  })

  it('2. the mobile sign-in control uses the localized nav.signIn label as its accessible name, not a hardcoded string', () => {
    expect(navActions).toContain('aria-label={t.signIn}')
    // Guard against a hardcoded single-language fallback creeping in.
    expect(navActions).not.toMatch(/aria-label="(Accedi|Sign in|Anmelden|Se connecter|Iniciar sesión)"/)
  })

  it('3. sign-in points at the existing owner login route, not a new/invented one', () => {
    expect(navActions).toContain('/dashboard/login')
    expect(navActions).not.toMatch(/\/dashboard\/signin|\/login\b(?!")/)
  })

  it('4. Create Event remains present and uses the cta-primary treatment', () => {
    expect(navActions).toContain('cta-primary')
    expect(navActions).toContain('{t.createRoom}')
  })

  it('5. the language switcher stays reachable below `sm` via the Sheet menu when hidden from the header', () => {
    // It's fine for the header row to hide the switcher below `sm`, but only
    // if the Sheet menu carries a real instance, not a link to nowhere.
    const headerHidesSwitcherBelowSm = /hidden sm:block[\s\S]{0,80}<LanguageSwitcher/.test(nav)
    if (headerHidesSwitcherBelowSm) {
      const switcherCount = (nav.match(/<LanguageSwitcher/g) || []).length
      expect(switcherCount).toBeGreaterThanOrEqual(2) // header instance + Sheet menu instance
    }
  })

  it('6b. the authenticated branch is untouched by responsive hiding (no `hidden`/`sm:` classes on the Dashboard link)', () => {
    const dashboardBranch = navActions.slice(
      navActions.indexOf('authenticated ? ('),
      navActions.indexOf(') : ('),
    )
    expect(dashboardBranch).toContain('/dashboard"')
    expect(dashboardBranch).not.toMatch(/\bhidden\b/)
    expect(dashboardBranch).not.toMatch(/sm:hidden|sm:inline-flex/)
  })

  it('7. the desktop (`sm:inline-flex`) sign-in button text/route is unchanged from before the fix', () => {
    expect(navActions).toMatch(/sm:inline-flex"[\s\S]{0,20}>\s*<a href="\/dashboard\/login">\{t\.signIn\}<\/a>/)
  })

  it('the Sheet menu carries a full-text sign-in/dashboard entry as a backup to the icon-only header control', () => {
    expect(nav).toMatch(/authenticated \? '\/dashboard' : '\/dashboard\/login'/)
    expect(nav).toMatch(/authenticated \? t\.dashboard : t\.signIn/)
  })

  it('the new mobile sign-in control never grants authorization — it is a plain <a> link, not a form/fetch/mutating action', () => {
    // Structural guard: the icon-only mobile control must be a same-origin
    // navigation link, exactly like its desktop counterpart — never a
    // client-side auth call of its own.
    const mobileBlock = navActions.slice(navActions.indexOf('sm:hidden'), navActions.indexOf('Desktop (sm and up)'))
    expect(mobileBlock).not.toMatch(/fetch\(|useOwnerSession|onClick/)
  })
})

describe('no legacy border-white/[0.0X] opacity literals remain (Redesign V4, Phase 1)', () => {
  it.each(ALL_MARKETING_PAGES.concat(['components/install-cta.jsx']))('%s has no border-white/[0.0X] literal', (relPath) => {
    const source = readComponent(relPath)
    expect(source).not.toMatch(/border-white\/\[0\.\d+\]/)
  })
})
