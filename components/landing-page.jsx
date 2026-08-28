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
import { useTranslations } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { MarketingNav } from '@/components/marketing/nav'
import { MarketingFooter } from '@/components/marketing/footer'
import { trackEvent } from '@/lib/analytics/track-client'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import { EVENT_HERO_CTA_CLICKED, EVENT_PRICING_LINK_CLICKED } from '@/lib/analytics/events'
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { UseCasePreview } from '@/components/marketing/use-case-preview'
import { ProblemSection } from '@/components/marketing/problem-section'
import { SectionHeader } from '@/components/marketing/section-header'


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
      <MarketingNav ctaAction="scroll" />

      {/* Hero */}
      <section id="main-content" className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-28" aria-label="Hero">
        <div className="absolute inset-0 bg-grid opacity-[0.06]" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 55%)' }}
          aria-hidden="true"
        />

        <div className="container relative px-4">
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
            {/* Left: text + form */}
            <div className="max-w-xl lg:max-w-2xl">
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
                            href={localizedPath(locale, '/pricing')}
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
                      href={localizedPath(locale, '/pricing')}
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

            {/* Right: PhoneMockup — scaled up at wide desktop so it carries as much
                visual weight as the headline column instead of floating small in
                the extra grid-column space. */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="relative w-full max-w-[320px] xl:origin-right xl:scale-110 2xl:scale-125">
                <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                <PhoneMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem → Solution */}
      <section className="border-t border-border bg-card py-20 sm:py-28" aria-labelledby="problem-heading">
        <div className="container px-4">
          <SectionHeader label={t.problemLabel} title={t.problemTitle} description={t.problemDesc} />
          <div className="mx-auto mt-14 sm:mt-16 max-w-4xl">
            <ProblemSection
              t={t}
              photos={[
                { src: '/marketing-placeholder/wedding-toast-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-detail-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-guests-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-dancefloor-thumb.jpg' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-t border-border py-20 sm:py-28" aria-labelledby="how-it-works-heading">
        <div className="container px-4">
          <SectionHeader label={t.hiwLabel} title={t.hiwTitle} description={t.hiwDesc} />
          <div className="mx-auto mt-14 sm:mt-16 max-w-5xl">
            <HowItWorks t={t} />
          </div>
        </div>
      </section>

      {/* Use Case Preview */}
      <section className="border-t border-border bg-card py-20 sm:py-28" aria-labelledby="use-cases-heading">
        <div className="container px-4">
          <SectionHeader label={t.useCasesLabel} title={t.useCasesTitle} description={t.useCasesDesc} />
          <div className="mx-auto mt-14 sm:mt-16 max-w-5xl">
            <UseCasePreview
              items={[
                {
                  href: localizedPath(locale, '/wedding-photo-sharing'),
                  icon: Heart,
                  title: t.weddings,
                  desc: t.weddingsDesc,
                  photoSrc: '/marketing-placeholder/wedding-couple-card.jpg',
                },
                {
                  href: localizedPath(locale, '/birthday-photo-sharing'),
                  icon: PartyPopper,
                  title: t.birthdays,
                  desc: t.birthdaysDesc,
                  photoSrc: '/marketing-placeholder/usecase-birthday-card.jpg',
                },
                {
                  href: localizedPath(locale, '/corporate-event-photo-sharing'),
                  icon: Building2,
                  title: t.corporate,
                  desc: t.corporateDesc,
                  photoSrc: '/marketing-placeholder/usecase-corporate-card.jpg',
                },
                {
                  href: localizedPath(locale, '/for-wedding-photographers'),
                  icon: Camera,
                  title: tNav.forPhotographers,
                  desc: t.photographersCardDesc,
                  photoSrc: '/marketing-placeholder/usecase-photographer-card.jpg',
                },
                {
                  href: localizedPath(locale, '/for-event-planners'),
                  icon: Users,
                  title: tNav.forPlanners,
                  desc: t.plannersCardDesc,
                  photoSrc: '/marketing-placeholder/usecase-planner-card.jpg',
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Benefit Callout */}
      <section className="border-t border-border bg-card py-20 sm:py-28" aria-labelledby="benefit-callout-heading">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl rounded-2xl border border-border bg-[hsl(var(--bg-elevated))] p-8 sm:p-10 text-center shadow-card">
            <h2 id="benefit-callout-heading" className="text-xl sm:text-2xl text-foreground font-display leading-relaxed font-bold">
              {t.benefitCalloutTitle}
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              {t.benefitCalloutDesc}
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

      <MarketingFooter />
    </div>
  )
}

export default LandingPage
