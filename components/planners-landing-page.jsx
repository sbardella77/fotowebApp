'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  QrCode,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Download,
  Lock,
  Infinity,
  Briefcase,
  CalendarDays,
  Smartphone,
  Heart,
  Zap,
  Camera,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import {
  EVENT_LANDING_VIEW,
  EVENT_HERO_CTA_CLICKED,
  EVENT_CREATE_ROOM_CLICKED,
} from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { UseCaseCards } from '@/components/marketing/use-case-cards'
import { UseCasePreview } from '@/components/marketing/use-case-preview'
import { SectionHeader } from '@/components/marketing/section-header'

const PLANNER_PHOTOS = [
  { src: '/marketing-placeholder/planner-checklist-thumb.jpg', heart: true },
  { src: '/marketing-placeholder/planner-working-thumb.jpg' },
  { src: '/marketing-placeholder/planner-vendor-thumb.jpg' },
  { src: '/marketing-placeholder/planner-guests-thumb.jpg', heart: true },
  { src: '/marketing-placeholder/planner-setup-thumb.jpg' },
  { src: '/marketing-placeholder/planner-supervision-thumb.jpg' },
]

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
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

export function PlannersLandingPage({ locale }) {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const t = useTranslations('planners')
  const tLanding = useTranslations('landing')
  const nav = useTranslations('nav')

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'planners' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'planners' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'planners',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'planners',
    })

    setIsCreating(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, ownerEmail: trimmedEmail }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = { error: `${tLanding.serverError} (${response.status}). ${tLanding.pleaseTryAgain}` }
      }
      if (response.ok && payload.event?.slug) {
        router.push(`/event/${payload.event.slug}?new=1`)
      } else if (!response.ok) {
        setCreateError(payload)
      }
    } catch (e) {
      console.error('[createEvent] Error:', e)
      setCreateError({ error: e.message || tLanding.genericError })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="scroll" />

      {/* Hero */}
      <section id="main-content" className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-[0.06]" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 55%)' }}
          aria-hidden="true"
        />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <div className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1">
              <CalendarDays className="h-3 w-3 text-accent-dark" aria-hidden="true" />
              <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {t.heroEyebrow}
              </span>
            </div>
            <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl text-balance">
              {t.heroHeadline1}{' '}
              <span className="text-accent-dark">
                {t.heroHeadline2}
              </span>
            </h1>
            <p className="animate-fade-up delay-200 mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t.heroSubheadline}
            </p>
            <div className="animate-fade-up delay-300 mt-8 flex justify-center">
              <TrustStrip items={[
                { icon: CalendarDays, text: t.trustMultiEvent },
                { icon: Zap, text: t.trustRealTime },
                { icon: Download, text: t.trustDeliver },
              ]} />
            </div>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 items-center gap-10 sm:grid-cols-2">
            {/* Create Form */}
            <div id="create" className="reveal min-w-0">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-elevated">
                <div className="space-y-3">
                  <Input
                    placeholder={t.eventPlaceholder}
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                    className="h-12 rounded-lg border-border bg-secondary"
                  />
                  <Input
                    placeholder={t.emailPlaceholder}
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                    className="h-12 rounded-lg border-border bg-secondary"
                  />
                  <Button
                    className="h-12 w-full cta-primary"
                    onClick={createEvent}
                    disabled={isCreating}
                  >
                    {isCreating ? (
                      <>{t.creating}</>
                    ) : (
                      <>
                        {t.ctaButton}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
                {createError && (
                  <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-left">
                    <p className="text-sm font-medium text-destructive">{createError.error || tLanding.genericError}</p>
                  </div>
                )}
                <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                  {t.formHelper}
                </p>
              </div>
            </div>

            {/* Phone Mockup */}
            <div className="reveal relative min-w-0 flex justify-center" style={{ transitionDelay: '100ms' }}>
              <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
              <PhoneMockup
                eventName="Q3 Product Launch"
                url="snaprooms.app/event/q3-launch"
                photos={PLANNER_PHOTOS}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal min-w-0 overflow-hidden rounded-2xl border border-border shadow-elevated">
              <div className="relative aspect-[4/3]">
                <Image
                  src="/marketing-placeholder/planner-working-card.jpg"
                  alt=""
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
                <div
                  className="absolute inset-0"
                  aria-hidden="true"
                  style={{ background: 'linear-gradient(180deg, transparent 45%, hsl(0 0% 8% / 0.75) 100%)' }}
                />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                    <QrCode className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold text-white">
                    {t.solution1Title}
                  </h3>
                  <p className="mt-1.5 text-sm text-white/85">
                    {t.solution1Desc}
                  </p>
                </div>
              </div>
            </div>
            <div className="reveal min-w-0" style={{ transitionDelay: '100ms' }}>
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t.problemTitle}
              </h2>
              <p className="mt-4 text-muted-foreground">
                {t.problemDesc1}
              </p>
              <p className="mt-3 text-muted-foreground">
                {t.problemDesc2}
              </p>
              <div className="mt-6 rounded-xl border border-border bg-surface p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary border border-border text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold text-foreground">
                  {t.solution2Title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.solution2Desc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.featuresLabel}
              title={t.featuresTitle}
              description={t.featuresDesc}
            />
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Infinity,
                title: t.feature1Title,
                desc: t.feature1Desc,
              },
              {
                icon: QrCode,
                title: t.feature2Title,
                desc: t.feature2Desc,
              },
              {
                icon: Smartphone,
                title: t.feature3Title,
                desc: t.feature3Desc,
              },
              {
                icon: Download,
                title: t.feature4Title,
                desc: t.feature4Desc,
              },
              {
                icon: Lock,
                title: t.feature5Title,
                desc: t.feature5Desc,
              },
              {
                icon: Briefcase,
                title: t.feature6Title,
                desc: t.feature6Desc,
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="reveal rounded-xl bg-surface border border-border p-6 transition-all duration-200 hover:-translate-y-px hover:border-[hsl(var(--border-visible))] hover:shadow-elevated"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border text-primary">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.useCasesLabel}
              title={t.useCasesTitle}
            />
          </div>
          <div className="mx-auto mt-16 max-w-5xl">
            <UseCaseCards cases={[
              { icon: Heart, title: t.useCase1Title, desc: t.useCase1Desc, color: 'text-primary' },
              { icon: Briefcase, title: t.useCase2Title, desc: t.useCase2Desc, color: 'text-primary' },
              { icon: Sparkles, title: t.useCase3Title, desc: t.useCase3Desc, color: 'text-primary' },
            ]} />
          </div>
        </div>
      </section>

      {/* Use-Case Callout */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10 shadow-elevated text-center">
              <Sparkles className="mx-auto h-6 w-6 text-primary" />
              <p className="mt-5 font-display text-xl font-bold text-foreground">
                {t.useCaseCalloutTitle}
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                {t.useCaseCalloutDesc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              title={t.pricingTitle}
              description={t.pricingDesc}
            />
          </div>

          <div className="mx-auto mt-10 max-w-md reveal">
            <div className="rounded-2xl border border-primary/20 bg-surface p-8 shadow-elevated">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                  {t.planLabel}
                </span>
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-foreground">{t.planPrice}</span>
                <span className="text-sm text-muted-foreground">{t.planPeriod}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.planDesc}
              </p>
              <Button className="mt-6 w-full cta-primary" asChild>
                <a href="/dashboard/login">
                  {t.planCta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <ul className="mt-6 space-y-2 text-sm">
                {[
                  t.planFeature1,
                  t.planFeature2,
                  t.planFeature3,
                  t.planFeature4,
                  t.planFeature5,
                  t.planFeature6,
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-8 text-center text-sm text-muted-foreground reveal">
            {t.customTerms}{' '}
            <a href="mailto:hello@snaprooms.app" className="text-accent-dark hover:underline">
              {t.contactUsLink}
            </a>
          </p>
        </div>
      </section>

      {/* Cross-link — other ways to use SnapRooms */}
      <section className="border-t border-border py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal"><SectionHeader label={t.crossLabel} title={t.crossTitle} /></div>
          <div className="mx-auto mt-12 max-w-5xl">
            <UseCasePreview
              items={[
                {
                  href: localizedPath(locale, '/wedding-photo-sharing'),
                  icon: Heart,
                  title: tLanding.weddings,
                  desc: tLanding.weddingsDesc,
                  photoSrc: '/marketing-placeholder/wedding-couple-card.jpg',
                },
                {
                  href: localizedPath(locale, '/corporate-event-photo-sharing'),
                  icon: Building2,
                  title: tLanding.corporate,
                  desc: tLanding.corporateDesc,
                  photoSrc: '/marketing-placeholder/usecase-corporate-card.jpg',
                },
                {
                  href: localizedPath(locale, '/for-wedding-photographers'),
                  icon: Camera,
                  title: nav.forPhotographers,
                  desc: tLanding.photographersCardDesc,
                  photoSrc: '/marketing-placeholder/usecase-photographer-card.jpg',
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t.finalTitle}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.finalDesc}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="cta-primary" asChild>
                <a href={localizedPath(locale, '/')}>{t.finalCta}</a>
              </Button>
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-white/[0.03]" asChild>
                <a href={localizedPath(locale, '/pricing')}>
                  {t.viewPricing}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
