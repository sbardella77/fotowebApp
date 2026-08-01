'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW, EVENT_HERO_CTA_CLICKED, EVENT_CREATE_ROOM_CLICKED } from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
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
import { LanguageSwitcher } from '@/components/language-switcher'
import { AuthAwareNavActions } from '@/components/auth-aware-nav-actions'
import { InstallCta } from '@/components/install-cta'
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
  const footer = useTranslations('footer')
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

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
          <div className="flex items-center gap-4">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {nav.howItWorks}
            </button>
            <button
              onClick={() => scrollToSection('faq')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {nav.faq}
            </button>
            <LanguageSwitcher />
            <AuthAwareNavActions t={nav} anonymousCreateHref="#create" />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
        {/* Grid background */}
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        {/* Radial fade toward edges */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 0%, rgba(8,12,20,0.85) 70%)'
          }}
        />

        <div className="container relative px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Copy + Form */}
              <div className="text-center lg:text-left">
                {/* Badge */}
                <div className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
                  <Heart className="h-3 w-3 text-rose-400" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                    {t.heroEyebrow}
                  </span>
                </div>

                {/* H1 */}
                <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-extrabold tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl">
                  {t.heroHeadline1}{' '}
                  <span className="text-gradient">{t.heroHeadline2}</span>
                </h1>

                {/* Subheadline */}
                <p className="animate-fade-up delay-200 mt-6 text-lg font-light leading-relaxed text-muted-foreground sm:text-xl">
                  {t.heroSubheadline}
                </p>

                {/* Create room form card */}
                <div
                  id="create"
                  className="animate-fade-up delay-300 mt-10 rounded-2xl border border-white/[0.08] bg-raised/60 p-6 shadow-elevated"
                >
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      placeholder={t.eventPlaceholder}
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
                    className="mt-3 h-12 w-full gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap cta-primary"
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

              {/* Right: PhoneMockup */}
              <div className="animate-fade-up delay-200 hidden lg:flex justify-center">
                <PhoneMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="border-t border-white/[0.06] py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: The Problem */}
              <div className="reveal">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-accent-dark">
                  {t.problemLabel}
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-foreground sm:text-3xl">
                  {t.problemTitle}
                </h2>
                <p className="mt-3 font-light text-muted-foreground">
                  {t.problemDesc}
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    { emoji: '💬', text: t.problem1 },
                    { emoji: '😰', text: t.problem2 },
                    { emoji: '⏰', text: t.problem3 },
                  ].map((item) => (
                    <div key={item.text} className="flex items-center gap-3 text-muted-foreground">
                      <span className="text-base">{item.emoji}</span>
                      <span className="text-sm font-light">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: The Solution */}
              <div className="reveal relative" style={{ transitionDelay: '100ms' }}>
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative space-y-4 surface-raised rounded-xl shadow-card p-6">
                  {[
                    {
                      icon: ImagePlus,
                      title: t.solution1Title,
                      desc: t.solution1Desc,
                    },
                    {
                      icon: Smartphone,
                      title: t.solution2Title,
                      desc: t.solution2Desc,
                    },
                    {
                      icon: Lock,
                      title: t.solution3Title,
                      desc: t.solution3Desc,
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-sm font-light text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
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
      <section className="border-t border-white/[0.06] py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="reveal order-2 lg:order-1">
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

              {/* Right: Visual */}
              <div className="reveal order-1 lg:order-2" style={{ transitionDelay: '100ms' }}>
                <div className="relative mx-auto max-w-sm">
                  <div className="absolute -top-4 -right-4 h-24 w-24 rounded-full bg-primary/10 blur-2xl" aria-hidden="true" />
                  <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-rose-500/10 blur-2xl" aria-hidden="true" />

                  <div className="relative rounded-xl border border-border bg-surface p-6 shadow-card">
                    <div className="text-center">
                      <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                        Sarah & Mike&apos;s Wedding
                      </p>
                      <div className="mx-auto my-4 flex h-40 w-40 items-center justify-center rounded-xl border-2 border-dashed border-border bg-raised">
                        <QrCode className="h-20 w-20 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-foreground">Scan to upload your photos</p>
                      <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">snaprooms.app/room/sarah-mike</p>
                    </div>
                  </div>

                  <div className="absolute -right-2 top-1/4 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span className="font-mono text-[0.65rem]">Instant upload</span>
                    </span>
                  </div>
                  <div className="absolute -left-2 bottom-1/4 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-primary" />
                      <span className="font-mono text-[0.65rem]">127 photos</span>
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
                className="reveal rounded-xl border border-border bg-surface p-6 transition-all duration-200 hover:-translate-y-px hover:border-white/[0.08]"
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
      <section className="border-t border-white/[0.06] py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div className="reveal">
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

              <div className="reveal relative" style={{ transitionDelay: '100ms' }}>
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative rounded-xl border border-border bg-surface p-8 shadow-card text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Shield className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-lg font-light text-muted-foreground">
                    &ldquo;{t.testimonialQuote}&rdquo;
                  </p>
                  <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
                    {t.testimonialAttribution}
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

      {/* Final CTA */}
      <section className="border-t border-white/[0.06] py-24 sm:py-32">
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
          </div>
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-4 pb-6">
        <InstallCta mode="landing" />
      </div>

      {/* Footer */}
      <footer className="bg-surface border-t border-border py-8">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <a href="/" className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Camera className="h-3 w-3" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-foreground">SnapRooms</span>
            </a>
            <p className="text-xs font-light text-muted-foreground">
              {footer.tagline}
            </p>
            <div className="flex items-center gap-4">
              <a href="/pricing" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {footer.pricing}
              </a>
              <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {footer.privacy}
              </a>
              <a href="/terms" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {footer.terms}
              </a>
              <a href="/dashboard/login" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {footer.organizerSignIn}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
