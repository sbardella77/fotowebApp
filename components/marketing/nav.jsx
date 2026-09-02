'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, ChevronDown, Camera, Users } from 'lucide-react'
import { SnapRoomsLogo } from '@/components/marketing/logo'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useOwnerSession } from '@/lib/use-owner-session'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_PRICING_LINK_CLICKED } from '@/lib/analytics/events'
import { AuthAwareNavActions } from '@/components/auth-aware-nav-actions'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetClose } from '@/components/ui/sheet'

const NAV_LINK_CLASS = 'px-3 py-2 text-sm font-medium transition-colors'

function navLinkClass(isActive) {
  return `${NAV_LINK_CLASS} ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`
}

export function MarketingNav({ variant = 'fixed', ctaAction = 'link' }) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Single owner-session check, shared by the header's auth actions and the
  // Sheet menu's account entry below — see auth-aware-nav-actions.jsx.
  const { authenticated, loading: authLoading } = useOwnerSession()

  const navClass =
    variant === 'fixed'
      ? 'fixed top-0 left-0 right-0 z-50'
      : 'relative'

  const homeHref = localizedPath(locale, '/')
  // "scroll": the current page has its own #create form (in-page anchor).
  // "link": no local create-form here (legal/pricing pages) — send to the homepage's.
  const anonymousCreateHref = ctaAction === 'scroll' ? '#create' : homeHref
  const pricingHref = localizedPath(locale, '/pricing')
  const howItWorksHref = `${homeHref}#how-it-works`
  const photographersHref = localizedPath(locale, '/for-wedding-photographers')
  const plannersHref = localizedPath(locale, '/for-event-planners')

  const isHome = pathname === homeHref
  const isPricing = pathname === pricingHref
  const isProfessionals = pathname === photographersHref || pathname === plannersHref

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:font-medium"
      >
        {t.skipToContent}
      </a>

      <nav className={`${navClass} bg-background/85 backdrop-blur-2xl border-b border-border sm:bg-background/70`}>
        <div className="container flex h-16 items-center justify-between px-3 sm:px-4">
          <SnapRoomsLogo href={homeHref} size="xl" className="flex-shrink-0" />

          {/* Desktop links */}
          <div className="hidden items-center gap-1 sm:flex">
            <a href={homeHref} className={navLinkClass(isHome)} aria-current={isHome ? 'page' : undefined}>
              {t.home}
            </a>
            <a href={howItWorksHref} className={navLinkClass(false)}>
              {t.howItWorks}
            </a>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`${navLinkClass(isProfessionals)} hidden items-center gap-1 lg:inline-flex`}
                  aria-current={isProfessionals ? 'page' : undefined}
                >
                  {t.forProfessionals}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1.5">
                <a
                  href={photographersHref}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Camera className="h-4 w-4 text-accent-dark" aria-hidden="true" />
                  {t.forPhotographers}
                </a>
                <a
                  href={plannersHref}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <Users className="h-4 w-4 text-accent-dark" aria-hidden="true" />
                  {t.forPlanners}
                </a>
              </PopoverContent>
            </Popover>
            <a
              href={pricingHref}
              className={navLinkClass(isPricing)}
              aria-current={isPricing ? 'page' : undefined}
              onClick={() => {
                trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_nav', locale, location: 'marketing_nav' })
              }}
            >
              {t.pricing}
            </a>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3">
            <div className="mx-1 hidden h-4 w-px bg-border sm:block" />

            {/* Hidden below `sm`: there isn't room for all four controls
                (language, sign-in, Create Event, hamburger) at phone widths
                without crowding the primary CTA. The same switcher is
                always available in the Sheet menu below. */}
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>

            <AuthAwareNavActions
              t={t}
              anonymousCreateHref={anonymousCreateHref}
              authenticated={authenticated}
              loading={authLoading}
            />

            {/* Mobile menu trigger: exposes the links that collapse below
                `sm`/`lg`, the language switcher (hidden from the header
                itself below `sm`), and a full-text sign-in/dashboard entry
                as a backup to the header's own compact mobile control.
                Create Event is already visible at every width via its own
                responsive variant, so it is intentionally not duplicated
                here. */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  aria-label={t.menu}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="flex w-[85%] flex-col gap-2 sm:max-w-xs">
                <SheetTitle>{t.menu}</SheetTitle>
                <nav className="flex flex-col gap-1" aria-label={t.menu}>
                  <SheetClose asChild>
                    <a href={homeHref} className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent" aria-current={isHome ? 'page' : undefined}>
                      {t.home}
                    </a>
                  </SheetClose>
                  <SheetClose asChild>
                    <a href={howItWorksHref} className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">
                      {t.howItWorks}
                    </a>
                  </SheetClose>
                  <SheetClose asChild>
                    <a href={photographersHref} className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">
                      {t.forPhotographers}
                    </a>
                  </SheetClose>
                  <SheetClose asChild>
                    <a href={plannersHref} className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent">
                      {t.forPlanners}
                    </a>
                  </SheetClose>
                  <SheetClose asChild>
                    <a
                      href={pricingHref}
                      className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent"
                      aria-current={isPricing ? 'page' : undefined}
                      onClick={() => {
                        trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_nav', locale, location: 'marketing_nav_mobile' })
                      }}
                    >
                      {t.pricing}
                    </a>
                  </SheetClose>

                  <div className="my-1 border-t border-border" role="separator" />

                  {/* Always available here — this is the one place the
                      language switcher is guaranteed reachable below `sm`,
                      since the header itself hides it at those widths. */}
                  <div className="px-3 py-1">
                    <LanguageSwitcher />
                  </div>

                  {/* Full-text account entry — a backup to the header's own
                      icon-only mobile sign-in control (see
                      auth-aware-nav-actions.jsx), so sign-in is never
                      exclusively behind an icon. Omitted only while the
                      owner-session check is still loading. */}
                  {!authLoading && (
                    <SheetClose asChild>
                      <a
                        href={authenticated ? '/dashboard' : '/dashboard/login'}
                        className="rounded-lg px-3 py-3 text-base font-medium text-foreground hover:bg-accent"
                      >
                        {authenticated ? t.dashboard : t.signIn}
                      </a>
                    </SheetClose>
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>
    </>
  )
}
