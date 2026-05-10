'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/components/i18n-provider'
import {
  PartyPopper,
  QrCode,
  Smartphone,
  Download,
  Gift,
  Cake,
  Music,
  Shield,
  Lock,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import {
  EVENT_LANDING_VIEW,
  EVENT_HERO_CTA_CLICKED,
  EVENT_CREATE_ROOM_CLICKED,
} from '@/lib/analytics/events'
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { HowItWorks } from '@/components/marketing/how-it-works'
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

export function BirthdayLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const t = useTranslations('birthday')

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'birthday' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'birthday' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'birthday',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'birthday',
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
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="scroll" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-pink-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
            <div className="animate-fade-up">
              <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                {t.heroEyebrow}
              </span>
              <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                {t.heroHeadline1}{' '}
                <span className="text-gradient">{t.heroHeadline2}</span>
              </h1>
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                {t.heroSubheadline}
              </p>

              <div className="mt-8 animate-fade-up delay-200">
                <TrustStrip
                  items={[
                    { icon: CheckCircle2, text: t.trustFreeForever },
                    { icon: CheckCircle2, text: t.trustUnlimitedGuests },
                    { icon: CheckCircle2, text: t.trustNoAppNeeded },
                  ]}
                />
              </div>

              {/* Create Form */}
              <div id="create" className="mt-10 max-w-lg animate-fade-up delay-300">
                <div className="rounded-2xl border border-white/[0.08] bg-raised/60 p-6 shadow-elevated">
                  <div className="space-y-3">
                    <Input
                      placeholder={t.eventPlaceholder}
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                      className="h-12 rounded-lg border-border bg-surface"
                    />
                    <Input
                      placeholder={t.emailPlaceholder}
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                      className="h-12 rounded-lg border-border bg-surface"
                    />
                    <Button
                      className="h-12 w-full cta-primary"
                      onClick={createEvent}
                      disabled={isCreating}
                    >
                      {isCreating ? (
                        t.creating
                      ) : (
                        <>
                          {t.ctaButton}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                    {t.finalMicrocopy}
                  </p>
                </div>
              </div>
            </div>

            <div className="hidden lg:flex justify-center animate-fade-up delay-200">
              <PhoneMockup eventName="Birthday Party" url="snaprooms.app/room/birthday" />
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="relative border-t border-white/[0.06] py-24 sm:py-32">
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
            <div className="reveal rounded-2xl border border-border bg-surface p-6 shadow-elevated" style={{ transitionDelay: '100ms' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-border text-primary shadow-subtle">
                <Cake className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                {t.solutionTitle}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.solutionDesc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader label={t.howItWorksLabel} title={t.howItWorksTitle} />
          </div>
          <div className="mx-auto mt-16 max-w-4xl">
            <HowItWorks t={t} />
          </div>
        </div>
      </section>

      {/* Why It Works for Birthdays */}
      <section className="relative border-t border-white/[0.06] py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader label={t.featuresLabel} title={t.featuresTitle} />
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Gift,
                title: t.feature1Title,
                desc: t.feature1Desc,
              },
              {
                icon: PartyPopper,
                title: t.feature2Title,
                desc: t.feature2Desc,
              },
              {
                icon: Music,
                title: t.feature3Title,
                desc: t.feature3Desc,
              },
              {
                icon: Smartphone,
                title: t.feature4Title,
                desc: t.feature4Desc,
              },
              {
                icon: Lock,
                title: t.feature5Title,
                desc: t.feature5Desc,
              },
              {
                icon: Download,
                title: t.feature6Title,
                desc: t.feature6Desc,
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="reveal rounded-2xl border border-border bg-surface p-6 shadow-elevated hover:-translate-y-px hover:border-white/[0.08] transition-all duration-200"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-border text-primary shadow-subtle">
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

      {/* QR Code Section */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal grid gap-10 sm:grid-cols-2 sm:items-center">
              <div>
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                  {t.qrBadge}
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {t.qrTitle}
                </h2>
                <p className="mt-4 text-muted-foreground">
                  {t.qrDesc1}
                </p>
                <p className="mt-3 text-muted-foreground">
                  {t.qrDesc2}
                </p>
              </div>
              <div className="reveal flex justify-center" style={{ transitionDelay: '100ms' }}>
                <div className="rounded-2xl border border-border bg-surface p-8 shadow-elevated">
                  <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-raised border border-border">
                    <QrCode className="h-20 w-20 text-primary" />
                  </div>
                  <p className="mt-4 text-center text-sm font-medium text-foreground">
                    {t.qrCardLabel}
                  </p>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    {t.qrCardSublabel}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Privacy */}
      <section className="relative border-t border-white/[0.06] py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised border border-border text-primary mx-auto shadow-subtle">
              <Shield className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t.privacyTitle}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.privacyDesc}
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              { title: t.privacyFeature1Title, desc: t.privacyFeature1Desc },
              { title: t.privacyFeature2Title, desc: t.privacyFeature2Desc },
              { title: t.privacyFeature3Title, desc: t.privacyFeature3Desc },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal rounded-2xl border border-border bg-surface p-5 text-center shadow-elevated"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <h3 className="font-display text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl">
            <div className="text-center reveal">
              <SectionHeader title={t.faqTitle} />
            </div>

            <div className="mt-10 reveal">
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  {
                    q: t.faq1Question,
                    a: t.faq1Answer,
                  },
                  {
                    q: t.faq2Question,
                    a: t.faq2Answer,
                  },
                  {
                    q: t.faq3Question,
                    a: t.faq3Answer,
                  },
                  {
                    q: t.faq4Question,
                    a: t.faq4Answer,
                  },
                  {
                    q: t.faq5Question,
                    a: t.faq5Answer,
                  },
                  {
                    q: t.faq6Question,
                    a: t.faq6Answer,
                  },
                ].map((faq, i) => (
                  <AccordionItem
                    key={i}
                    value={`item-${i}`}
                    className="rounded-2xl border border-border bg-surface px-5 shadow-elevated"
                  >
                    <AccordionTrigger className="text-left text-sm font-semibold text-foreground hover:no-underline">
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative pb-16 sm:pb-24">
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
            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              {t.finalMicrocopy}
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
