'use client'

import { useRef, useEffect } from 'react'
import {
  Camera,
  Heart,
  PartyPopper,
  Building2,
  QrCode,
  Share2,
  Users,
  ImagePlus,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Smartphone,
  Download,
  Printer
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InstallCta } from '@/components/install-cta'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_HERO_CTA_CLICKED } from '@/lib/analytics/events'

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
  const featuresRef = useRef(null)
  useScrollReveal()

  return (
    <div className="dark relative min-h-screen bg-background font-body text-foreground">
      {/* Noise texture overlay */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {tNav.howItWorks}
            </button>
            <Button size="sm" variant="ghost" asChild className="font-body">
              <a href="/dashboard/login">{tNav.signIn}</a>
            </Button>
            <Button size="sm" onClick={() => scrollToSection('create')} className="font-body">
              {tNav.createRoom}
            </Button>
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
          aria-hidden="true"
        />
        {/* Blur orbs */}
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            {/* Logo */}
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="mx-auto mb-6 h-12 w-12 rounded-lg object-cover animate-fade-up"
            />

            {/* Badge */}
            <div className="animate-fade-up delay-100 mb-6 inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                {t.badge}
              </span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-up delay-200 font-display text-[2rem] font-extrabold tracking-[-0.03em] text-white sm:text-5xl sm:leading-tight lg:text-6xl">
              {t.headline1}
              <span className="block text-gradient">{t.headline2}</span>
            </h1>

            {/* Subheadline */}
            <p className="animate-fade-up delay-300 mx-auto mt-6 max-w-xl text-lg font-light text-muted-foreground">
              {t.subheadline}
            </p>

            {/* CTA */}
            <div id="create" className="animate-fade-up delay-400 mt-10 flex flex-col items-center gap-4">
              <div className="flex w-full max-w-md flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder={t.roomNamePlaceholder}
                    className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <Button
                  size="lg"
                  className="h-12 gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap glow-blue"
                  onClick={() => {
                    trackEvent(EVENT_HERO_CTA_CLICKED, { page_type: 'landing', variant: 'generic', position: 'hero' })
                    onCreateEvent()
                  }}
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
              </div>

              {createError?.limit === 'room_count' && (
                <div className="mx-auto max-w-md rounded-xl border border-white/[0.07] bg-[#141C2E] p-4 text-left">
                  <p className="text-sm font-medium text-white">
                    {t.errorLimitTitle}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.errorLimitDesc}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="glow-blue" asChild>
                      <a href="/pricing">{t.viewPricing}</a>
                    </Button>
                    <Button size="sm" variant="outline" className="border-white/[0.07] bg-[#0D1220]" asChild>
                      <a href="/dashboard/login">{t.startProfessional}</a>
                    </Button>
                  </div>
                </div>
              )}

              {createError && createError.limit !== 'room_count' && (
                <div className="mx-auto max-w-md rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-left">
                  <p className="text-sm font-medium text-red-400">
                    {createError.error || t.genericError}
                  </p>
                </div>
              )}

              {/* Microcopy */}
              <p className="text-sm font-light text-muted-foreground">
                {t.microcopy1}
              </p>

              {/* Trust line */}
              <p className="text-xs font-light text-muted-foreground">
                {t.trustLine1}
              </p>
              <p className="text-xs font-light text-muted-foreground/70">
                {t.trustLine2}
              </p>

              {/* Secondary owner CTA */}
              <p className="text-xs text-muted-foreground">
                {t.alreadyCreated}{' '}
                <a href="/dashboard/login" className="underline underline-offset-2 hover:text-foreground">
                  {t.signInLink}
                </a>
              </p>

              {/* Social proof */}
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground/60">
                {t.socialProof1}
              </p>

              {/* Micro-urgency / quiet reassurance */}
              <p className="text-xs font-light text-muted-foreground/70">
                {t.socialProof2}
              </p>
            </div>

            {/* Trust signals */}
            <div className="animate-fade-up delay-500 mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t.freeForever}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t.unlimitedGuests}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{t.instantGallery}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              {t.hiwLabel}
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              {t.hiwTitle}
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              {t.hiwDesc}
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                step: '01',
                icon: Sparkles,
                title: t.step1Title,
                desc: t.step1Desc,
              },
              {
                step: '02',
                icon: Share2,
                title: t.step2Title,
                desc: t.step2Desc,
              },
              {
                step: '03',
                icon: ImagePlus,
                title: t.step3Title,
                desc: t.step3Desc,
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className="reveal relative flex flex-col items-center text-center"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <item.icon className="h-6 w-6" />
                </div>
                <div className="mt-4">
                  <div className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                    {t.stepLabel} {item.step}
                  </div>
                  <h3 className="mt-1 font-display text-lg font-bold tracking-tight text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm font-light text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why SnapRooms - Pain Point */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: The Problem */}
              <div className="reveal">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  {t.problemLabel}
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
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
                <div className="relative space-y-4 rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                  {[
                    {
                      icon: CheckCircle2,
                      title: t.solution1Title,
                      desc: t.solution1Desc,
                    },
                    {
                      icon: Smartphone,
                      title: t.solution2Title,
                      desc: t.solution2Desc,
                    },
                    {
                      icon: Users,
                      title: t.solution3Title,
                      desc: t.solution3Desc,
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display text-lg font-bold tracking-tight text-white">
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

      {/* Use Cases */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              {t.useCasesLabel}
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              {t.useCasesTitle}
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              {t.useCasesDesc}
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                icon: Heart,
                color: 'text-rose-400',
                bg: 'bg-rose-500/10',
                title: t.weddings,
                desc: t.weddingsDesc,
                bullets: [t.weddingsBullet1, t.weddingsBullet2],
              },
              {
                icon: PartyPopper,
                color: 'text-amber-400',
                bg: 'bg-amber-500/10',
                title: t.birthdays,
                desc: t.birthdaysDesc,
                bullets: [t.birthdaysBullet1, t.birthdaysBullet2],
              },
              {
                icon: Building2,
                color: 'text-blue-400',
                bg: 'bg-blue-500/10',
                title: t.corporate,
                desc: t.corporateDesc,
                bullets: [t.corporateBullet1, t.corporateBullet2],
              },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 transition-all duration-200 hover:-translate-y-px hover:border-white/[0.12]"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#111827]">
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm font-light text-muted-foreground">
                  {item.desc}
                </p>
                <ul className="mt-4 space-y-2 text-sm font-light text-muted-foreground">
                  {item.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QR Sharing Section */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="reveal order-2 lg:order-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
                  <QrCode className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                    {t.qrBadge}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
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
                    { icon: Printer, title: t.tableCards, desc: t.tableCardsDesc },
                    { icon: Download, title: t.entrancePosters, desc: t.entrancePostersDesc },
                    { icon: Share2, title: t.digitalShare, desc: t.digitalShareDesc },
                    { icon: Sparkles, title: t.cleanDesign, desc: t.cleanDesignDesc },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-display text-sm font-bold text-white">{item.title}</h4>
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
                  <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-cyan-500/10 blur-2xl" aria-hidden="true" />

                  <div className="relative rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                    <div className="text-center">
                      <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                        Sarah & Mike&apos;s Wedding
                      </p>
                      <div className="mx-auto my-4 flex h-40 w-40 items-center justify-center rounded-xl border-2 border-dashed border-white/[0.07] bg-[#111827]">
                        <QrCode className="h-20 w-20 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-white">{t.scanToUpload}</p>
                      <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">snaprooms.app/room/sarah-mike</p>
                    </div>
                  </div>

                  <div className="absolute -right-2 top-1/4 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span className="font-mono text-[0.65rem]">{t.instantUpload}</span>
                    </span>
                  </div>
                  <div className="absolute -left-2 bottom-1/4 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-primary" />
                      <span className="font-mono text-[0.65rem]">47 photos</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-12">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-lg font-light text-muted-foreground">
              &ldquo;{t.quote}
              <span className="text-white">{t.quoteHighlight}</span>&rdquo;
            </p>
            <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
              {t.quoteAttribution}
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
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
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder={t.finalEmailPlaceholder}
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap glow-blue"
                onClick={onCreateEvent}
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
      <footer className="border-t border-white/[0.07] bg-[#0D1220] py-8">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Camera className="h-3 w-3" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
            </div>
            <p className="text-xs font-light text-muted-foreground">
              {tFooter.tagline}
            </p>
            <div className="flex items-center gap-4">
              <a href="/pricing" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.pricing}
              </a>
              <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.privacy}
              </a>
              <a href="/terms" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.terms}
              </a>
              <a href="/dashboard/login" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                {tFooter.organizerSignIn}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
