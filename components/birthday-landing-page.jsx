'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
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
  Users,
  Heart,
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

const BIRTHDAY_PHOTOS = [
  { src: '/marketing-placeholder/birthday-candid-thumb.jpg', heart: true },
  { src: '/marketing-placeholder/birthday-cake-thumb.jpg' },
  { src: '/marketing-placeholder/birthday-friends-thumb.jpg', heart: true },
  { src: '/marketing-placeholder/birthday-dance-thumb.jpg' },
  { src: '/marketing-placeholder/birthday-laughter-thumb.jpg' },
  { src: '/marketing-placeholder/birthday-group-thumb.jpg' },
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

export function BirthdayLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const t = useTranslations('birthday')
  const tLanding = useTranslations('landing')
  const locale = useLocale()

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
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div className="min-w-0 text-center lg:text-left">
              <div className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1">
                <PartyPopper className="h-3 w-3 text-accent-dark" aria-hidden="true" />
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  {t.heroEyebrow}
                </span>
              </div>
              <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl text-balance">
                {t.heroHeadline1}{' '}
                <span className="text-accent-dark">{t.heroHeadline2}</span>
              </h1>
              <p className="animate-fade-up delay-200 mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
                {t.heroSubheadline}
              </p>

              <div className="animate-fade-up delay-300 mt-8 flex justify-center lg:justify-start">
                <TrustStrip
                  items={[
                    { icon: CheckCircle2, text: t.trustFreeForever },
                    { icon: CheckCircle2, text: t.trustUnlimitedGuests },
                    { icon: CheckCircle2, text: t.trustNoAppNeeded },
                  ]}
                />
              </div>

              {/* Create Form */}
              <div id="create" className="animate-fade-up delay-400 mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-card p-6 shadow-elevated lg:mx-0">
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
                      t.creating
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
                  {t.finalMicrocopy}
                </p>
              </div>
            </div>

            {/* Right: PhoneMockup — visible at every breakpoint */}
            <div className="animate-fade-up delay-200 relative flex min-w-0 justify-center lg:justify-end">
              <div className="relative w-full max-w-[320px] xl:origin-right xl:scale-110 2xl:scale-125">
                <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                <PhoneMockup
                  eventName="Alex's Birthday"
                  url="snaprooms.app/event/alex-birthday"
                  photos={BIRTHDAY_PHOTOS}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal min-w-0">
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
            <div className="reveal min-w-0 overflow-hidden rounded-2xl border border-border shadow-elevated" style={{ transitionDelay: '100ms' }}>
              <div className="relative aspect-[4/3]">
                <Image
                  src="/marketing-placeholder/birthday-cake-card.jpg"
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
                    <Cake className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 font-display text-lg font-semibold text-white">
                    {t.solutionTitle}
                  </h3>
                  <p className="mt-1.5 text-sm text-white/85">
                    {t.solutionDesc}
                  </p>
                </div>
              </div>
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
      <section className="relative border-t border-border py-24 sm:py-32">
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
                className="reveal rounded-2xl border border-border bg-surface p-6 shadow-elevated hover:-translate-y-px hover:border-border transition-all duration-200"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border text-primary shadow-subtle">
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
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="container px-4">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal min-w-0">
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
            <div className="reveal min-w-0" style={{ transitionDelay: '100ms' }}>
              <div className="relative mx-auto max-w-sm">
                <div className="absolute -inset-6 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                <div className="relative overflow-hidden rounded-2xl border border-border shadow-elevated">
                  <div className="relative aspect-square">
                    <Image src="/marketing-placeholder/birthday-candid-square.jpg" alt="" fill sizes="384px" className="object-cover" />
                    <div
                      className="absolute inset-0"
                      aria-hidden="true"
                      style={{ background: 'linear-gradient(180deg, transparent 55%, hsl(0 0% 8% / 0.7) 100%)' }}
                    />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white">
                      <QrCode className="h-8 w-8 text-foreground" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{t.qrCardLabel}</p>
                      <p className="font-mono text-[0.65rem] text-white/80">{t.qrCardSublabel}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Privacy */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-secondary border border-border text-primary shadow-subtle">
              <Shield className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t.privacyTitle}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.privacyDesc}
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl grid-cols-1 gap-5 sm:grid-cols-3">
            {[
              { title: t.privacyFeature1Title, desc: t.privacyFeature1Desc },
              { title: t.privacyFeature2Title, desc: t.privacyFeature2Desc },
              { title: t.privacyFeature3Title, desc: t.privacyFeature3Desc },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal min-w-0 rounded-2xl border border-border bg-surface p-5 text-center shadow-elevated"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <h3 className="font-display text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cross-link — other ways to use SnapRooms */}
      <section className="border-t border-border py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal"><SectionHeader label={t.crossLabel} title={t.crossTitle} /></div>
          <div className="mx-auto mt-12 grid max-w-2xl gap-4 sm:grid-cols-2">
            {[
              {
                href: localizedPath(locale, '/private-party-photo-sharing'),
                icon: PartyPopper,
                title: t.crossPrivatePartyQ,
                desc: t.crossPrivatePartyDesc,
                cta: t.crossPrivatePartyCta,
                photoSrc: '/marketing-placeholder/usecase-private-party-card.jpg',
              },
              {
                href: localizedPath(locale, '/wedding-photo-sharing'),
                icon: Heart,
                title: t.crossWeddingQ,
                desc: t.crossWeddingDesc,
                cta: t.crossWeddingCta,
                photoSrc: '/marketing-placeholder/wedding-couple-card.jpg',
              },
            ].map((item, i) => (
              <a
                key={item.href}
                href={item.href}
                className="reveal group relative flex min-h-[220px] flex-col justify-end overflow-hidden rounded-2xl border border-border shadow-subtle transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <Image
                  src={item.photoSrc}
                  alt=""
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div
                  className="absolute inset-0"
                  aria-hidden="true"
                  style={{ background: 'linear-gradient(180deg, transparent 30%, hsl(0 0% 8% / 0.75) 100%)' }}
                />
                <div className="relative p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
                    <item.icon className="h-4.5 w-4.5 text-white" aria-hidden="true" />
                  </div>
                  <h3 className="mt-3 font-display text-base font-bold tracking-tight text-white">{item.title}</h3>
                  <p className="mt-1 text-xs text-white/80 leading-relaxed line-clamp-2">{item.desc}</p>
                  <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                    {item.cta}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </div>
              </a>
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
                <a href={localizedPath(locale, '/')}>{t.finalCta}</a>
              </Button>
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-white/[0.03]" asChild>
                <a href={localizedPath(locale, '/pricing')}>
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
