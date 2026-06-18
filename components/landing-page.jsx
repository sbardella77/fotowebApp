'use client'

import { useEffect } from 'react'
import {
  Camera,
  Heart,
  PartyPopper,
  Building2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InstallCta } from '@/components/install-cta'
import { useTranslations } from '@/components/i18n-provider'
import { LanguageSwitcher } from '@/components/language-switcher'
import { AuthAwareNavActions } from '@/components/auth-aware-nav-actions'
import { trackEvent } from '@/lib/analytics/track-client'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import { EVENT_HERO_CTA_CLICKED, EVENT_PRICING_LINK_CLICKED } from '@/lib/analytics/events'
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { UseCaseCards } from '@/components/marketing/use-case-cards'
import { SectionHeader } from '@/components/marketing/section-header'

function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
  }
}

function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
    )

    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

/* ── A/B Test Configuration ────────────────────────────────────────────── */
const CTA_VARIANT = 'default' // 'default' | 'action' | 'personal' | 'short'

function getCtaCopy(t, variant) {
  const copies = {
    default: { hero: t.ctaButton, final: t.finalCta },
    action: { hero: 'Create your free event — start now', final: 'Start your free event' },
    personal: { hero: 'Create my free event', final: 'Create my event now' },
    short: { hero: 'Create event', final: 'Create event' },
  }
  return copies[variant] || copies.default
}

export function LandingPage({
  locale,
  onCreateEvent,
  eventName,
  setEventName,
  ownerEmail,
  setOwnerEmail,
  isCreating,
  createError = null,
  onClearCreateError,
}) {
  const t = useTranslations('landing')
  const tNav = useTranslations('nav')
  const tFooter = useTranslations('footer')
  const cta = getCtaCopy(t, CTA_VARIANT)
  useScrollReveal()

  useEffect(() => {
    if (createError?.limit === 'room_count') {
      trackUpsellImpression({
        upsellType: 'room_limit',
        source: 'landing_room_limit',
        location: 'landing',
        ctaPlan: 'professional',
      })
    }
  }, [createError?.limit])

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      {/* Skip to content link for accessibility */}
      <a
        href="#create"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:font-medium"
      >
        Skip to create event
      </a>

      {/* Navigation */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl"
        aria-label="Main navigation"
      >
        <div className="container flex h-16 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5" aria-label="SnapRooms home">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle">
              <Camera className="h-[18px] w-[18px]" aria-hidden="true" />
            </div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              {tNav.howItWorks}
            </button>
            <a
              href="/pricing"
              className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
              onClick={() => {
                trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_nav', locale, location: 'landing_inline_nav' })
              }}
            >
              {tNav.pricing}
            </a>
            <LanguageSwitcher />
            <AuthAwareNavActions t={tNav} />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-28" aria-label="Hero">
        <div className="absolute inset-0 bg-grid opacity-[0.06]" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 55%)' }}
          aria-hidden="true"
        />

        <div className="container relative px-4">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            {/* Left: text + form */}
            <div className="max-w-xl">
              <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-4 py-1.5 shadow-subtle">
                <Sparkles className="h-3.5 w-3.5 text-accent-dark" aria-hidden="true" />
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t.badge}
                </span>
              </div>

              <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-bold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl text-balance">
                {t.headline1}
                <span className="block text-accent-dark mt-2 sm:mt-3">{t.headline2}</span>
              </h1>

              <p className="animate-fade-up delay-200 mt-6 text-lg sm:text-xl text-muted-foreground max-w-lg leading-relaxed">
                {t.subheadline}
              </p>

              {/* CTA Form */}
              <div id="create" className="animate-fade-up delay-300 mt-10">
                <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-elevated">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="flex-1">
                      <label htmlFor="event-name" className="sr-only">{t.roomNamePlaceholder}</label>
                      <Input
                        id="event-name"
                        value={eventName}
                        onChange={(e) => setEventName(e.target.value)}
                        placeholder={t.roomNamePlaceholder}
                        className="h-12 rounded-xl border-border bg-secondary text-base font-body text-foreground placeholder:text-[hsl(var(--text-disabled))] shadow-subtle"
                        aria-required="true"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="owner-email" className="sr-only">{t.emailPlaceholder}</label>
                      <Input
                        id="owner-email"
                        type="email"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        placeholder={t.emailPlaceholder}
                        className="h-12 rounded-xl border-border bg-secondary text-base font-body text-foreground placeholder:text-[hsl(var(--text-disabled))] shadow-subtle"
                        aria-required="true"
                      />
                    </div>
                  </div>
                  <Button
                    size="lg"
                    className="mt-3 h-14 sm:h-12 w-full gap-2 rounded-xl px-8 text-base font-body font-bold whitespace-nowrap cta-primary tracking-tight"
                    onClick={() => {
                      trackEvent(EVENT_HERO_CTA_CLICKED, { page_type: 'landing', variant: 'generic', position: 'hero' })
                      onCreateEvent()
                    }}
                    disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
                    aria-label={isCreating ? 'Creating event...' : cta.hero}
                  >
                    {isCreating ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    ) : (
                      <>
                        {cta.hero}
                        <ArrowRight className="h-5 w-5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>

                {/* Error messages with aria-live */}
                <div aria-live="polite" aria-atomic="true">
                  {createError?.limit === 'room_count' && (
                    <div className="mx-auto mt-4 max-w-lg rounded-xl border border-border bg-card p-5 text-left shadow-card">
                      <p className="text-sm font-semibold text-foreground">{t.errorLimitTitle}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t.errorLimitDesc}</p>
                      <div className="mt-4 flex gap-2">
                        <Button size="sm" className="cta-primary" asChild>
                          <a
                            href="/dashboard/login"
                            onClick={() => {
                              trackUpsellClick({ upsellType: 'room_limit', source: 'landing_room_limit', location: 'landing', ctaPlan: 'professional' })
                            }}
                          >
                            {t.startProfessional}
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border bg-secondary text-foreground hover:bg-[hsl(var(--bg-elevated))]"
                          asChild
                        >
                          <a
                            href="/pricing"
                            onClick={() => {
                              trackUpsellClick({ upsellType: 'room_limit', source: 'landing_room_limit', location: 'landing', ctaPlan: 'professional' })
                            }}
                          >
                            {t.viewPricing}
                          </a>
                        </Button>
                      </div>
                    </div>
                  )}

                  {createError && createError.limit !== 'room_count' && (
                    <div className="mx-auto mt-4 max-w-lg rounded-xl border border-destructive/20 bg-destructive/10 p-5 text-left">
                      <p className="text-sm font-medium text-destructive">{createError.error || t.genericError}</p>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <TrustStrip
                    items={[
                      { icon: CheckCircle2, text: t.freeForever },
                      { icon: Users, text: t.unlimitedGuests },
                      { icon: Zap, text: t.instantGallery },
                    ]}
                  />
                </div>

                <p className="mt-4 text-xs font-normal text-muted-foreground">
                  <span className="sm:hidden">
                    {t.microcopy1}{' '}&middot;{' '}
                    <a
                      href="/pricing"
                      className="underline underline-offset-2 hover:text-foreground transition-colors"
                      onClick={() => {
                        trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_hero_mobile', locale, location: 'landing_hero_microcopy' })
                      }}
                    >
                      {t.viewPricing}
                    </a>
                  </span>
                  <span className="hidden sm:inline">
                    {t.microcopy1}{' '}&middot;{' '}
                    <a href="/dashboard/login" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      {t.signInLink}
                    </a>
                  </span>
                </p>
              </div>
            </div>

            {/* Right: PhoneMockup */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="relative w-full max-w-[320px]">
                <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                <PhoneMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-border bg-card py-20 sm:py-28" aria-labelledby="how-it-works-heading">
        <div className="container px-4">
          <SectionHeader label={t.hiwLabel} title={t.hiwTitle} description={t.hiwDesc} />
          <div className="mx-auto mt-14 sm:mt-16 max-w-5xl">
            <HowItWorks t={t} />
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="border-t border-border py-20 sm:py-28" aria-labelledby="use-cases-heading">
        <div className="container px-4">
          <SectionHeader label={t.useCasesLabel} title={t.useCasesTitle} description={t.useCasesDesc} />
          <div className="mx-auto mt-14 sm:mt-16 max-w-5xl">
            <UseCaseCards
              cases={[
                { icon: Heart, color: 'text-rose-500', title: t.weddings, desc: t.weddingsDesc, bullets: [t.weddingsBullet1, t.weddingsBullet2] },
                { icon: PartyPopper, color: 'text-amber-600', title: t.birthdays, desc: t.birthdaysDesc, bullets: [t.birthdaysBullet1, t.birthdaysBullet2] },
                { icon: Building2, color: 'text-blue-600', title: t.corporate, desc: t.corporateDesc, bullets: [t.corporateBullet1, t.corporateBullet2] },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-t border-border bg-card py-20 sm:py-28" aria-label="Testimonial">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl rounded-2xl border border-border bg-[hsl(var(--bg-elevated))] p-8 sm:p-10 text-center shadow-card">
            <blockquote>
              <p className="text-xl sm:text-2xl text-foreground font-display leading-relaxed">
                &ldquo;{t.quote}
                <span className="text-accent-dark">{t.quoteHighlight}</span>&rdquo;
              </p>
            </blockquote>
            <p className="mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t.quoteAttribution}
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border py-24 sm:py-32" aria-label="Get started">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-elevated text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-foreground sm:text-4xl lg:text-5xl text-balance">
              {t.finalTitle}
            </h2>
            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
              {t.finalDesc}
            </p>

            <div className="mt-8 mx-auto flex w-full max-w-lg flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label htmlFor="final-event-name" className="sr-only">{t.finalPlaceholder}</label>
                  <Input
                    id="final-event-name"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder={t.finalPlaceholder}
                    className="h-12 rounded-xl border-border bg-secondary text-base font-body text-foreground placeholder:text-[hsl(var(--text-disabled))] shadow-subtle"
                    aria-required="true"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="final-owner-email" className="sr-only">{t.finalEmailPlaceholder}</label>
                  <Input
                    id="final-owner-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder={t.finalEmailPlaceholder}
                    className="h-12 rounded-xl border-border bg-secondary text-base font-body text-foreground placeholder:text-[hsl(var(--text-disabled))] shadow-subtle"
                    aria-required="true"
                  />
                </div>
              </div>
              <Button
                size="lg"
                className="h-12 w-full gap-2 rounded-xl px-8 text-base font-body font-bold whitespace-nowrap cta-primary tracking-tight"
                onClick={onCreateEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
                aria-label={isCreating ? 'Creating event...' : cta.final}
              >
                {isCreating ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                ) : (
                  <>
                    {cta.final}
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>

            <p className="mt-6 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t.finalMicrocopy}
            </p>
          </div>
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-4 pb-10">
        <InstallCta mode="landing" />
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-12">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow">
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-foreground">SnapRooms</span>
            </div>
            <p className="text-xs font-medium text-muted-foreground text-center sm:text-left max-w-xs">
              {tFooter.tagline}
            </p>
            <nav className="flex flex-wrap items-center justify-center gap-5" aria-label="Footer navigation">
              <a href="/pricing" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.pricing}
              </a>
              <a href="/privacy" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.privacy}
              </a>
              <a href="/terms" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.terms}
              </a>
              <a href="/dashboard/login" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.organizerSignIn}
              </a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
