'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { UseCaseCards } from '@/components/marketing/use-case-cards'
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
  const t = useTranslations('planners')

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
        payload = { error: `Server error (${response.status}). Please try again.` }
      }
      if (response.ok && payload.event?.slug) {
        router.push(`/event/${payload.event.slug}?new=1`)
      }
    } catch (e) {
      console.error('[createEvent] Error:', e)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="dark relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="scroll" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark animate-fade-up">
              {t.heroEyebrow}
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl animate-fade-up delay-100">
              {t.heroHeadline1}{' '}
              <span className="text-gradient">
                {t.heroHeadline2}
              </span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              {t.heroSubheadline}
            </p>
            <div className="mt-8 animate-fade-up delay-300">
              <TrustStrip items={[
                { icon: CalendarDays, text: t.trustMultiEvent },
                { icon: Zap, text: t.trustRealTime },
                { icon: Download, text: t.trustDeliver },
              ]} />
            </div>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl items-center gap-10 sm:grid-cols-2">
            {/* Create Form */}
            <div id="create" className="animate-fade-up delay-400">
              <div className="rounded-2xl border border-white/[0.08] bg-raised/60 p-6 shadow-elevated">
                <div className="space-y-3">
                  <Input
                    placeholder={t.eventPlaceholder}
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                    className="h-12 rounded-lg border-border bg-raised"
                  />
                  <Input
                    placeholder={t.emailPlaceholder}
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                    className="h-12 rounded-lg border-border bg-raised"
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
                <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                  {t.formHelper}
                </p>
              </div>
            </div>

            {/* Phone Mockup */}
            <div className="animate-fade-up delay-500 flex justify-center">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="relative border-t border-white/[0.06] bg-raised/50 py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal">
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t.problemTitle}
              </h2>
              <p className="mt-4 text-muted-foreground">
                {t.problemDesc1}
              </p>
              <p className="mt-3 text-muted-foreground">
                {t.problemDesc2}
              </p>
            </div>
            <div className="reveal space-y-4" style={{ transitionDelay: '100ms' }}>
              <div className="rounded-xl bg-surface border border-white/[0.08] p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-white/[0.08] text-primary">
                  <QrCode className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                  {t.solution1Title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.solution1Desc}
                </p>
              </div>
              <div className="rounded-xl bg-surface border border-white/[0.08] p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-white/[0.08] text-primary">
                  <CalendarDays className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
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
                className="reveal rounded-xl bg-surface border border-white/[0.08] p-6 transition-all duration-200 hover:-translate-y-px hover:border-white/[0.12] hover:shadow-elevated"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-white/[0.08] text-primary">
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
      <section className="relative border-t border-white/[0.06] bg-raised/50 py-24 sm:py-32">
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

      {/* Testimonial */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <div className="rounded-2xl border border-white/[0.08] bg-surface p-8 sm:p-10 shadow-elevated text-center">
              <Sparkles className="mx-auto h-6 w-6 text-primary" />
              <blockquote className="mt-5 font-display text-xl text-foreground">
                &ldquo;{t.testimonialQuote}&rdquo;
              </blockquote>
              <p className="mt-4 text-sm text-muted-foreground">
                {t.testimonialAttribution}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="relative border-t border-white/[0.06] bg-raised/50 py-24 sm:py-32">
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
                <a href="/">{t.finalCta}</a>
              </Button>
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/pricing">
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
