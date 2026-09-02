'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW, EVENT_HERO_CTA_CLICKED, EVENT_CREATE_ROOM_CLICKED, EVENT_PRICING_LINK_CLICKED } from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import {
  Camera,
  Heart,
  Church,
  Wine,
  QrCode,
  Share2,
  Users,
  ImagePlus,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Smartphone,
  Download,
  Printer,
  Shield,
  Lock,
  Infinity,
  Archive,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarketingNav } from '@/components/marketing/nav'
import { MarketingFooter } from '@/components/marketing/footer'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { PhoneMockup } from '@/components/marketing/phone-mockup'
import { TrustStrip } from '@/components/marketing/trust-strip'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { UseCaseCards } from '@/components/marketing/use-case-cards'
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
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )

    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

export function WeddingLandingPage({ locale = 'en' }) {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const t = useTranslations('wedding')
  const nav = useTranslations('nav')
  const tLanding = useTranslations('landing')

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'wedding' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'wedding' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, { page_type: 'landing', variant: 'wedding', position: 'hero' })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, { page_type: 'landing', variant: 'wedding' })

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

  const trustItems = [
    { icon: CheckCircle2, text: t.trustFreeForever },
    { icon: CheckCircle2, text: t.trustUnlimitedGuests },
    { icon: CheckCircle2, text: t.trustInstantGallery },
  ]

  const useCases = [
    {
      icon: Church,
      color: 'text-rose-400',
      title: t.useCase1Title,
      desc: t.useCase1Desc,
      bullets: [t.useCase1Bullet1, t.useCase1Bullet2],
    },
    {
      icon: Wine,
      color: 'text-amber-400',
      title: t.useCase2Title,
      desc: t.useCase2Desc,
      bullets: [t.useCase2Bullet1, t.useCase2Bullet2],
    },
    {
      icon: Heart,
      color: 'text-pink-400',
      title: t.useCase3Title,
      desc: t.useCase3Desc,
      bullets: [t.useCase3Bullet1, t.useCase3Bullet2],
    },
  ]

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      {/* Noise texture overlay */}
      <div className="noise-overlay" aria-hidden="true" />

      <MarketingNav ctaAction="scroll" />

      {/* Hero Section */}
      <section id="main-content" className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-[0.06]" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 0%, hsl(var(--primary) / 0.06) 0%, transparent 55%)' }}
          aria-hidden="true"
        />

        <div className="container relative px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Copy + Form */}
              <div className="min-w-0 text-center lg:text-left">
                {/* Badge */}
                <div className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1">
                  <Heart className="h-3 w-3 text-accent-dark" aria-hidden="true" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {t.heroEyebrow}
                  </span>
                </div>

                {/* H1 */}
                <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl text-balance">
                  {t.heroHeadline1}{' '}
                  <span className="text-accent-dark">{t.heroHeadline2}</span>
                </h1>

                {/* Subheadline */}
                <p className="animate-fade-up delay-200 mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
                  {t.heroSubheadline}
                </p>

                {/* Create event form card */}
                <div
                  id="create"
                  className="animate-fade-up delay-300 mt-10 rounded-2xl border border-border bg-card p-6 shadow-elevated"
                >
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      placeholder={t.eventPlaceholder}
                      className="h-12 flex-1 rounded-lg border-border bg-secondary text-base font-body text-foreground placeholder:text-muted-foreground"
                    />
                    <Input
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder={t.finalEmailPlaceholder}
                      className="h-12 flex-1 rounded-lg border-border bg-secondary text-base font-body text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                  <Button
                    size="lg"
                    className="mt-3 h-12 w-full gap-2 rounded-lg px-8 text-base font-body font-semibold whitespace-nowrap cta-primary"
                    onClick={createEvent}
                    disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
                  >
                    {isCreating ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <>
                        {t.ctaButton}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                  {createError && (
                    <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-left">
                      <p className="text-sm font-medium text-destructive">{createError.error || tLanding.genericError}</p>
                    </div>
                  )}
                </div>

                {/* Trust signals */}
                <div className="animate-fade-up delay-500 mt-6">
                  <TrustStrip items={trustItems} />
                </div>
              </div>

              {/* Right: PhoneMockup — visible at every breakpoint, matching the
                  approved main-landing hero pattern (stacked on mobile). */}
              <div className="animate-fade-up delay-200 relative flex min-w-0 justify-center lg:justify-end">
                <div className="relative w-full max-w-[320px]">
                  <div className="absolute -inset-8 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
                  <PhoneMockup />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem → Solution */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader label={t.problemLabel} title={t.problemTitle} description={t.problemDesc} />
          </div>
          <div className="mx-auto mt-14 sm:mt-16 max-w-4xl">
            <ProblemSection
              t={t}
              photos={[
                { src: '/marketing-placeholder/wedding-toast-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-guests-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-dancefloor-thumb.jpg' },
                { src: '/marketing-placeholder/wedding-detail-thumb.jpg' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-y border-border bg-background py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.howItWorksLabel}
              title={t.howItWorksTitle}
              description={t.howItWorksDesc}
            />
          </div>

          <div className="mx-auto mt-12 max-w-5xl">
            <HowItWorks t={t} />
          </div>
        </div>
      </section>

      {/* Wedding Use Cases */}
      <section className="border-y border-border bg-background py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.useCasesLabel}
              title={t.useCasesTitle}
              description={t.useCasesDesc}
            />
          </div>

          <div className="mx-auto mt-12 max-w-5xl">
            <UseCaseCards cases={useCases} />
          </div>
        </div>
      </section>

      {/* QR Code Section */}
      <section className="relative overflow-hidden border-t border-border py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="reveal order-2 min-w-0 lg:order-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
                  <QrCode className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                    {t.qrBadge}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">
                  {t.qrTitle}
                </h2>
                <p className="mt-2 text-base font-light text-muted-foreground">
                  {t.qrDesc1}
                </p>
                <p className="mt-4 font-light text-muted-foreground">
                  {t.qrDesc2}
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {[
                    { icon: Printer, title: t.qrFeature1Title, desc: t.qrFeature1Desc },
                    { icon: Download, title: t.qrFeature2Title, desc: t.qrFeature2Desc },
                    { icon: Share2, title: t.qrFeature3Title, desc: t.qrFeature3Desc },
                    { icon: Sparkles, title: t.qrFeature4Title, desc: t.qrFeature4Desc },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-display text-sm font-bold text-foreground">{item.title}</h4>
                        <p className="text-sm font-light text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: Visual — a real reception/table-detail photo with a
                  QR chip overlay, in place of the old fake-QR icon box. */}
              <div className="reveal order-1 min-w-0 lg:order-2" style={{ transitionDelay: '100ms' }}>
                <div className="relative mx-auto max-w-sm">
                  <div className="absolute -inset-6 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />

                  <div className="relative overflow-hidden rounded-2xl border border-border shadow-elevated">
                    <div className="relative aspect-square">
                      <Image
                        src="/marketing-placeholder/wedding-detail-square.jpg"
                        alt=""
                        fill
                        sizes="384px"
                        className="object-cover"
                      />
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
                        <p className="text-sm font-semibold text-white">Sarah & Mike&apos;s Wedding</p>
                        <p className="font-mono text-[0.65rem] text-white/80">snaprooms.app/event/sarah-mike</p>
                      </div>
                    </div>
                  </div>

                  <div className="absolute -right-2 top-6 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-elevated">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-accent-dark" aria-hidden="true" />
                      <span className="font-mono text-[0.65rem] text-foreground">Instant upload</span>
                    </span>
                  </div>
                  <div className="absolute -left-2 bottom-6 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-elevated">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-accent-dark" aria-hidden="true" />
                      <span className="font-mono text-[0.65rem] text-foreground">127 photos</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-y border-border bg-background py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.benefitsLabel}
              title={t.benefitsTitle}
              description={t.benefitsDesc}
            />
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Users,
                title: t.benefit1Title,
                desc: t.benefit1Desc,
              },
              {
                icon: ImagePlus,
                title: t.benefit2Title,
                desc: t.benefit2Desc,
              },
              {
                icon: Smartphone,
                title: t.benefit3Title,
                desc: t.benefit3Desc,
              },
              {
                icon: Archive,
                title: t.benefit4Title,
                desc: t.benefit4Desc,
              },
              {
                icon: EyeOff,
                title: t.benefit5Title,
                desc: t.benefit5Desc,
              },
              {
                icon: Download,
                title: t.benefit6Title,
                desc: t.benefit6Desc,
              },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal rounded-xl border border-border bg-surface p-6 transition-all duration-200 hover:-translate-y-px hover:border-border"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-bold tracking-tight text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm font-light text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust / Privacy */}
      <section className="border-t border-border py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
              <div className="reveal min-w-0">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                  {t.privacyLabel}
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">
                  {t.privacyTitle}
                </h2>
                <p className="mt-3 font-light text-muted-foreground">
                  {t.privacyDesc}
                </p>
                <div className="mt-6 space-y-4">
                  {[
                    {
                      icon: Shield,
                      title: t.privacyFeature1Title,
                      desc: t.privacyFeature1Desc,
                    },
                    {
                      icon: Lock,
                      title: t.privacyFeature2Title,
                      desc: t.privacyFeature2Desc,
                    },
                    {
                      icon: Infinity,
                      title: t.privacyFeature3Title,
                      desc: t.privacyFeature3Desc,
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-display text-sm font-bold text-foreground">{item.title}</h4>
                        <p className="text-sm font-light text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="reveal relative min-w-0" style={{ transitionDelay: '100ms' }}>
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative rounded-xl border border-border bg-surface p-8 shadow-card text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Shield className="h-7 w-7" />
                  </div>
                  <p className="mt-4 font-display text-lg font-bold text-foreground">
                    {t.capabilityCalloutTitle}
                  </p>
                  <p className="mt-2 text-sm font-light text-muted-foreground">
                    {t.capabilityCalloutDesc}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-border bg-background py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader
              label={t.faqLabel}
              title={t.faqTitle}
            />
          </div>

          <div className="reveal mx-auto mt-12 max-w-3xl">
            <Accordion type="single" collapsible className="w-full">
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
                {
                  q: t.faq7Question,
                  a: t.faq7Answer,
                },
              ].map((item, i) => (
                <AccordionItem key={i} value={`item-${i}`} className="border-border">
                  <AccordionTrigger className="text-left font-display text-base font-semibold tracking-tight text-foreground hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm font-light text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Professional Redirect — photo-first cards, same visual language as
          the main landing's UseCasePreview (not the component itself: that
          grid is tuned for 3+ items, this is exactly 2). */}
      <section className="border-t border-border bg-card py-20 sm:py-28">
        <div className="container px-4">
          <div className="reveal">
            <SectionHeader label={t.proLabel} title={t.proTitle} />
          </div>
          <div className="mx-auto mt-12 grid max-w-2xl gap-4 sm:grid-cols-2">
            {[
              {
                href: localizedPath(locale, '/for-wedding-photographers'),
                icon: Camera,
                title: t.proPhotographerQ,
                desc: tLanding.photographersCardDesc,
                photoSrc: '/marketing-placeholder/usecase-photographer-card.jpg',
              },
              {
                href: localizedPath(locale, '/for-event-planners'),
                icon: Users,
                title: t.proPlannerQ,
                desc: tLanding.plannersCardDesc,
                photoSrc: '/marketing-placeholder/usecase-planner-card.jpg',
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
                  {item.desc && (
                    <p className="mt-1 text-xs text-white/80 leading-relaxed line-clamp-2">{item.desc}</p>
                  )}
                  <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                    {i === 0 ? nav.forPhotographers : nav.forPlanners}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-foreground sm:text-4xl">
              {t.finalTitle}
            </h2>
            <p className="mt-4 text-lg font-light text-muted-foreground">
              {t.finalDesc}
            </p>

            <div className="mt-8 flex w-full max-w-md mx-auto flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder={t.finalPlaceholder}
                  className="h-12 flex-1 rounded-lg border-input bg-surface text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder={t.finalEmailPlaceholder}
                  className="h-12 flex-1 rounded-lg border-input bg-surface text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap cta-primary"
                onClick={createEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
              >
                {isCreating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    {t.finalCta}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
              {createError && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-left">
                  <p className="text-sm font-medium text-destructive">{createError.error || tLanding.genericError}</p>
                </div>
              )}
            </div>

            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              {t.finalMicrocopy}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              <a
                href={localizedPath(locale, '/pricing')}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => {
                  trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_wedding_final', locale, location: 'wedding_final_cta' })
                }}
              >
                {t.viewPricing}
              </a>
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
