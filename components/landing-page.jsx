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
  Printer,
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
      { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
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
  useScrollReveal()

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] bg-background/70 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle">
              <Camera className="h-[18px] w-[18px]" />
            </div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              {tNav.howItWorks}
            </button>
            <Button size="sm" variant="ghost" asChild className="hidden sm:inline-flex">
              <a href="/dashboard/login">{tNav.signIn}</a>
            </Button>
            <Button size="sm" asChild className="glow-accent">
              <a href="/">{tNav.createRoom}</a>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
        <div className="absolute inset-0 bg-grid opacity-40" aria-hidden="true" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center, transparent 0%, hsl(var(--bg-base) / 0.9) 70%)' }}
          aria-hidden="true"
        />
        <div className="absolute -top-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-primary/5 blur-[120px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-blue-500/5 blur-[120px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="mx-auto mb-8 h-14 w-14 rounded-2xl object-cover animate-fade-up shadow-elevated"
            />

            <div className="animate-fade-up delay-100 mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-surface px-4 py-1.5 shadow-subtle">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {t.badge}
              </span>
            </div>

            <h1 className="animate-fade-up delay-200 font-display text-[2.5rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl text-balance">
              {t.headline1}
              <span className="block text-gradient mt-2 sm:mt-3">{t.headline2}</span>
            </h1>

            <p className="animate-fade-up delay-300 mx-auto mt-7 max-w-lg text-lg font-light leading-relaxed text-muted-foreground">
              {t.subheadline}
            </p>

            {/* CTA Form */}
            <div id="create" className="animate-fade-up delay-400 mt-12">
              <div className="mx-auto flex w-full max-w-md flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder={t.roomNamePlaceholder}
                    className="h-12 flex-1 rounded-xl border-white/[0.06] bg-surface text-base font-body text-foreground placeholder:text-muted-foreground shadow-subtle"
                  />
                  <Input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    className="h-12 flex-1 rounded-xl border-white/[0.06] bg-surface text-base font-body text-foreground placeholder:text-muted-foreground shadow-subtle"
                  />
                </div>
                <Button
                  size="lg"
                  className="h-12 gap-2 rounded-xl px-8 text-base font-body font-semibold whitespace-nowrap glow-accent"
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
                <div className="mx-auto mt-4 max-w-md rounded-2xl border border-white/[0.06] bg-surface p-5 text-left shadow-card">
                  <p className="text-sm font-semibold text-foreground">{t.errorLimitTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.errorLimitDesc}</p>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="glow-accent" asChild>
                      <a href="/pricing">{t.viewPricing}</a>
                    </Button>
                    <Button size="sm" variant="outline" className="border-white/[0.06] bg-raised" asChild>
                      <a href="/dashboard/login">{t.startProfessional}</a>
                    </Button>
                  </div>
                </div>
              )}

              {createError && createError.limit !== 'room_count' && (
                <div className="mx-auto mt-4 max-w-md rounded-2xl border border-destructive/20 bg-destructive/10 p-5 text-left">
                  <p className="text-sm font-medium text-destructive">{createError.error || t.genericError}</p>
                </div>
              )}

              <div className="mt-7 flex flex-wrap items-center justify-center gap-5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  {t.freeForever}
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  {t.unlimitedGuests}
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  {t.instantGallery}
                </span>
              </div>

              <p className="mt-4 text-xs font-light text-muted-foreground/70">
                {t.microcopy1}{' '}&middot;{' '}
                <a href="/dashboard/login" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  {t.signInLink}
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-y border-white/[0.04] bg-surface py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary">
              {t.hiwLabel}
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl lg:text-4xl text-balance">
              {t.hiwTitle}
            </h2>
            <p className="mt-4 text-lg font-light leading-relaxed text-muted-foreground">
              {t.hiwDesc}
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              { step: '01', icon: Sparkles, title: t.step1Title, desc: t.step1Desc },
              { step: '02', icon: Share2, title: t.step2Title, desc: t.step2Desc },
              { step: '03', icon: ImagePlus, title: t.step3Title, desc: t.step3Desc },
            ].map((item, i) => (
              <div
                key={item.step}
                className="reveal relative flex flex-col items-center text-center"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-raised border border-white/[0.06] text-primary shadow-subtle">
                  <item.icon className="h-7 w-7" />
                </div>
                <div className="mt-6">
                  <div className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary">
                    {t.stepLabel} {item.step}
                  </div>
                  <h3 className="mt-3 font-display text-lg font-bold tracking-tight text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
              <div className="reveal">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary">
                  {t.problemLabel}
                </span>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl lg:text-4xl text-balance">
                  {t.problemTitle}
                </h2>
                <p className="mt-4 text-lg font-light leading-relaxed text-muted-foreground">
                  {t.problemDesc}
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    { emoji: '💬', text: t.problem1 },
                    { emoji: '😰', text: t.problem2 },
                    { emoji: '⏰', text: t.problem3 },
                  ].map((item) => (
                    <div key={item.text} className="flex items-center gap-3 text-muted-foreground">
                      <span className="text-lg">{item.emoji}</span>
                      <span className="text-sm font-light">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="reveal relative" style={{ transitionDelay: '100ms' }}>
                <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-primary/8 to-transparent" />
                <div className="relative space-y-5 rounded-2xl border border-white/[0.06] bg-surface p-8 shadow-card">
                  {[
                    { icon: CheckCircle2, title: t.solution1Title, desc: t.solution1Desc },
                    { icon: Smartphone, title: t.solution2Title, desc: t.solution2Desc },
                    { icon: Users, title: t.solution3Title, desc: t.solution3Desc },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display text-base font-bold tracking-tight text-foreground">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">
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
      <section className="border-y border-white/[0.04] bg-surface py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary">
              {t.useCasesLabel}
            </span>
            <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl lg:text-4xl text-balance">
              {t.useCasesTitle}
            </h2>
            <p className="mt-4 text-lg font-light leading-relaxed text-muted-foreground">
              {t.useCasesDesc}
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-3">
            {[
              { icon: Heart, color: 'text-rose-400', bg: 'bg-rose-500/10', title: t.weddings, desc: t.weddingsDesc, bullets: [t.weddingsBullet1, t.weddingsBullet2] },
              { icon: PartyPopper, color: 'text-amber-400', bg: 'bg-amber-500/10', title: t.birthdays, desc: t.birthdaysDesc, bullets: [t.birthdaysBullet1, t.birthdaysBullet2] },
              { icon: Building2, color: 'text-blue-400', bg: 'bg-blue-500/10', title: t.corporate, desc: t.corporateDesc, bullets: [t.corporateBullet1, t.corporateBullet2] },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-background p-7 transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.10] hover:shadow-elevated"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised">
                  <item.icon className={`h-6 w-6 ${item.color}`} />
                </div>
                <h3 className="mt-6 font-display text-lg font-bold tracking-tight text-foreground">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
                <ul className="mt-5 space-y-3 text-sm font-light text-muted-foreground">
                  {item.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QR Section */}
      <section className="py-24 sm:py-32">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
              <div className="reveal order-2 lg:order-1">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-surface px-4 py-1.5 shadow-subtle">
                  <QrCode className="h-3.5 w-3.5 text-primary" />
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-primary">
                    {t.qrBadge}
                  </span>
                </div>
                <h2 className="mt-6 font-display text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl lg:text-4xl text-balance">
                  {t.qrTitle}
                </h2>
                <p className="mt-4 text-lg font-light leading-relaxed text-muted-foreground">
                  {t.qrDesc1}
                </p>
                <p className="mt-4 font-light leading-relaxed text-muted-foreground">
                  {t.qrDesc2}
                </p>

                <div className="mt-10 grid gap-5 sm:grid-cols-2">
                  {[
                    { icon: Printer, title: t.tableCards, desc: t.tableCardsDesc },
                    { icon: Download, title: t.entrancePosters, desc: t.entrancePostersDesc },
                    { icon: Share2, title: t.digitalShare, desc: t.digitalShareDesc },
                    { icon: Sparkles, title: t.cleanDesign, desc: t.cleanDesignDesc },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h4 className="font-display text-sm font-semibold text-foreground">{item.title}</h4>
                        <p className="text-sm font-light leading-relaxed text-muted-foreground">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="reveal order-1 lg:order-2" style={{ transitionDelay: '100ms' }}>
                <div className="relative mx-auto max-w-xs sm:max-w-sm">
                  <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-primary/8 blur-3xl" aria-hidden="true" />
                  <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-blue-500/8 blur-3xl" aria-hidden="true" />

                  <div className="relative rounded-[2.5rem] border border-white/[0.06] bg-surface p-6 shadow-card sm:p-7">
                    <div className="mx-auto mb-6 h-1.5 w-16 rounded-full bg-white/8" />
                    <div className="text-center">
                      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        Sarah & Mike&apos;s Wedding
                      </p>
                      <div className="mx-auto my-6 flex h-48 w-48 items-center justify-center rounded-3xl border-2 border-dashed border-white/[0.06] bg-raised">
                        <div className="text-center">
                          <QrCode className="mx-auto h-20 w-20 text-muted-foreground" />
                          <p className="mt-2 font-mono text-[10px] text-muted-foreground">snaprooms.app</p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-foreground">{t.scanToUpload}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">snaprooms.app/room/sarah-mike</p>
                    </div>

                    <div className="absolute -right-3 top-1/4 rounded-full border border-white/[0.06] bg-surface px-3 py-1.5 text-xs font-medium shadow-elevated">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-success" />
                        <span className="font-mono text-[10px]">{t.instantUpload}</span>
                      </span>
                    </div>
                    <div className="absolute -left-3 bottom-1/4 rounded-full border border-white/[0.06] bg-surface px-3 py-1.5 text-xs font-medium shadow-elevated">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3 w-3 text-primary" />
                        <span className="font-mono text-[10px]">47 photos</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-y border-white/[0.04] bg-surface py-16">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-xl font-light leading-relaxed text-muted-foreground">
              &ldquo;{t.quote}
              <span className="text-foreground">{t.quoteHighlight}</span>&rdquo;
            </p>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {t.quoteAttribution}
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 sm:py-32">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-foreground sm:text-4xl lg:text-5xl text-balance">
              {t.finalTitle}
            </h2>
            <p className="mt-6 text-lg font-light leading-relaxed text-muted-foreground">
              {t.finalDesc}
            </p>

            <div className="mt-10 flex w-full max-w-md mx-auto flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder={t.finalPlaceholder}
                  className="h-12 flex-1 rounded-xl border-white/[0.06] bg-surface text-base font-body text-foreground placeholder:text-muted-foreground shadow-subtle"
                />
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder={t.finalEmailPlaceholder}
                  className="h-12 flex-1 rounded-xl border-white/[0.06] bg-surface text-base font-body text-foreground placeholder:text-muted-foreground shadow-subtle"
                />
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 rounded-xl px-8 text-base font-body font-semibold whitespace-nowrap glow-accent"
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

            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t.finalMicrocopy}
            </p>
          </div>
        </div>
      </section>

      <div className="container mx-auto max-w-3xl px-4 pb-10">
        <InstallCta mode="landing" />
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] bg-surface py-10">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-subtle">
                <Camera className="h-3.5 w-3.5" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
            </div>
            <p className="text-xs font-light text-muted-foreground">
              {tFooter.tagline}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-5">
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
