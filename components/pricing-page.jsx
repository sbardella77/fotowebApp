'use client'

import { useEffect } from 'react'
import {
  Check,
  Minus,
  Sparkles,
  ArrowRight,
  HelpCircle,
  Briefcase,
  Heart,
  Calendar,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW } from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
import { SectionHeader } from '@/components/marketing/section-header'
import { TrustStrip } from '@/components/marketing/trust-strip'

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

const eventTiers = [
  {
    id: 'free',
    name: 'Free',
    badge: null,
    price: '€0',
    interval: null,
    target: 'Trial users & small personal events',
    description: 'One room for a casual get-together. See how SnapRooms works before you upgrade.',
    cta: { label: 'Create free room', href: '/', variant: 'outline' },
    features: [
      { name: 'Active rooms', value: '1' },
      { name: 'Photo limit', value: '50 photos' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full gallery downloads', value: false },
      { name: 'SnapRooms branding removed', value: false },
      { name: 'Wedding-focused premium experience', value: false },
      { name: 'Commercial use', value: false },
      { name: 'Priority support', value: false },
      { name: 'Custom setup', value: false },
    ],
  },
  {
    id: 'pro-event',
    name: 'Pro Event',
    badge: 'Most popular',
    price: '€29',
    interval: '/ event',
    target: 'Private hosts, birthdays, parties',
    description: 'Unlock unlimited photos, full gallery downloads, and a premium experience for one special event.',
    cta: { label: 'Upgrade this event', href: '/dashboard/login', variant: 'primary' },
    features: [
      { name: 'Active rooms', value: '1 premium' },
      { name: 'Photo limit', value: 'Unlimited' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full gallery downloads', value: true },
      { name: 'SnapRooms branding removed', value: true },
      { name: 'Wedding-focused premium experience', value: false },
      { name: 'Commercial use', value: false },
      { name: 'Priority support', value: true },
      { name: 'Custom setup', value: false },
    ],
  },
  {
    id: 'wedding-pro',
    name: 'Wedding Pro',
    badge: null,
    price: '€49',
    interval: '/ event',
    target: 'Couples & wedding hosts',
    description: 'Everything in Pro Event, with wedding-specific QR assets, longer access, and a premium experience designed for your big day.',
    cta: { label: 'Create your wedding room', href: '/dashboard/login', variant: 'outline' },
    features: [
      { name: 'Active rooms', value: '1 premium' },
      { name: 'Photo limit', value: 'Unlimited' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full gallery downloads', value: true },
      { name: 'SnapRooms branding removed', value: true },
      { name: 'Wedding-focused premium experience', value: true },
      { name: 'Commercial use', value: false },
      { name: 'Priority support', value: true },
      { name: 'Custom setup', value: false },
    ],
  },
]

const recurringTiers = [
  {
    id: 'professional',
    name: 'Professional',
    badge: null,
    price: '€79',
    interval: '/ month',
    secondaryPrice: '€790 / year',
    target: 'Photographers, planners, venues',
    description: 'Run multiple events for multiple clients. Commercial use included. Built for professionals who rely on SnapRooms every week.',
    cta: { label: 'Start Professional', href: '/dashboard/login', variant: 'outline' },
    features: [
      { name: 'Active rooms', value: 'Multiple' },
      { name: 'Photo limit', value: 'Unlimited' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full gallery downloads', value: true },
      { name: 'SnapRooms branding removed', value: true },
      { name: 'Wedding-focused premium experience', value: true },
      { name: 'Commercial use', value: true },
      { name: 'Priority support', value: true },
      { name: 'Custom setup', value: false },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    badge: 'Custom',
    price: 'Custom',
    interval: null,
    target: 'Agencies, corporate teams, enterprise',
    description: 'Tailored volume pricing, custom commercial terms, and dedicated support for larger event operations.',
    cta: { label: 'Contact sales', href: 'mailto:hello@snaprooms.app', variant: 'outline' },
    features: [
      { name: 'Active rooms', value: 'Unlimited' },
      { name: 'Photo limit', value: 'Unlimited' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full gallery downloads', value: true },
      { name: 'SnapRooms branding removed', value: true },
      { name: 'Wedding-focused premium experience', value: true },
      { name: 'Commercial use', value: true },
      { name: 'Priority support', value: 'Dedicated' },
      { name: 'Custom setup', value: true },
    ],
  },
]

const allTiers = [...eventTiers, ...recurringTiers]

function getFaqs(t) {
  return [
    { q: t.pricingFaq1Question, a: t.pricingFaq1Answer },
    { q: t.pricingFaq2Question, a: t.pricingFaq2Answer },
    { q: t.pricingFaq3Question, a: t.pricingFaq3Answer },
    { q: t.pricingFaq4Question, a: t.pricingFaq4Answer },
    { q: t.pricingFaq5Question, a: t.pricingFaq5Answer },
    { q: t.pricingFaq6Question, a: t.pricingFaq6Answer },
  ]
}

function FeatureValue({ value }) {
  if (value === true) {
    return <Check className="h-4 w-4 text-primary mx-auto" />
  }
  if (value === false) {
    return <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />
  }
  return <span className="text-sm text-muted-foreground">{value}</span>
}

function translateTierName(t, tier) {
  switch (tier.id) {
    case 'free': return t.freeTierName
    case 'pro-event': return t.proEvent
    case 'wedding-pro': return t.weddingPro
    case 'professional': return t.professional
    case 'business': return t.business
    default: return tier.name
  }
}

function translateTierTarget(t, tier) {
  switch (tier.id) {
    case 'free': return t.freeTierAudience
    case 'pro-event': return t.proEventAudience
    case 'wedding-pro': return t.weddingProAudience
    case 'professional': return t.professionalAudience
    case 'business': return t.businessAudience
    default: return tier.target
  }
}

function translateTierDescription(t, tier) {
  switch (tier.id) {
    case 'free': return t.freeTierDesc
    case 'pro-event': return t.proEventDesc
    case 'wedding-pro': return t.weddingProDesc
    case 'professional': return t.professionalDesc
    case 'business': return t.businessDesc
    default: return tier.description
  }
}

function translateTierCta(t, tier) {
  switch (tier.id) {
    case 'free': return t.createFreeRoomBtn
    case 'pro-event': return t.upgradeThisEvent
    case 'wedding-pro': return t.createWeddingRoom
    case 'professional': return t.startProfessional
    case 'business': return t.contactSales
    default: return tier.cta.label
  }
}

function translateInterval(t, interval) {
  if (interval === '/ event') return t.perEvent
  if (interval === '/ month') return t.perMonth
  return interval
}

function translateFeatureName(t, name) {
  const map = {
    'Active rooms': t.activeRooms,
    'Photo limit': t.photoLimit,
    'Guest uploads': t.guestUploads,
    'QR code sharing': t.qrCodeSharing,
    'Full gallery downloads': t.fullGalleryDownloads,
    'SnapRooms branding removed': t.brandingRemoved,
    'Wedding-focused premium experience': t.weddingPremium,
    'Commercial use': t.commercialUse,
    'Priority support': t.prioritySupport,
    'Custom setup': t.customSetup,
  }
  return map[name] || name
}

function translateFeatureValue(t, value) {
  if (value === 'Multiple') return t.multiple
  if (value === 'Dedicated') return t.dedicated
  return value
}

function TierCard({ tier, index, delayOffset = 0 }) {
  const t = useTranslations('pricing')

  const displayName = translateTierName(t, tier)
  const displayTarget = translateTierTarget(t, tier)
  const displayDescription = translateTierDescription(t, tier)
  const displayCta = translateTierCta(t, tier)
  const displayInterval = translateInterval(t, tier.interval)
  const displayBadge = tier.badge === 'Most popular' ? t.mostPopular : tier.badge === 'Custom' ? t.businessPrice : tier.badge

  const isPopular = tier.badge === 'Most popular'

  return (
    <div
      className={`reveal relative flex flex-col rounded-2xl border bg-surface p-6 sm:p-8 ${
        isPopular
          ? 'border-primary/30'
          : 'border-white/[0.08]'
      }`}
      style={{ transitionDelay: `${(index + delayOffset) * 60}ms` }}
    >
      {tier.badge && (
        <div className="absolute -top-3 left-5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
              isPopular
                ? 'bg-primary text-black'
                : 'border border-border bg-surface text-muted-foreground'
            }`}
          >
            {isPopular && <Sparkles className="h-3 w-3" />}
            {displayBadge}
          </span>
        </div>
      )}

      <div className="mt-2">
        <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {displayTarget}
        </span>
        <h3 className="mt-2 font-display text-lg font-bold text-foreground">{displayName}</h3>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold text-foreground">{tier.price}</span>
        {displayInterval && <span className="text-sm text-muted-foreground">{displayInterval}</span>}
      </div>

      {tier.secondaryPrice && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t.or} <span className="text-foreground">{tier.secondaryPrice}</span> ({t.save17})
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{displayDescription}</p>

      <div className="mt-5">
        {tier.cta.variant === 'primary' ? (
          <Button className="w-full cta-primary" size="sm" asChild>
            <a href={tier.cta.href}>
              {displayCta}
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full border-border bg-transparent hover:bg-surface"
            size="sm"
            asChild
          >
            <a href={tier.cta.href}>{displayCta}</a>
          </Button>
        )}
      </div>

      <ul className="mt-6 space-y-2.5">
        {tier.features.map((f) => (
          <li key={f.name} className="flex items-start gap-2.5 text-sm">
            {f.value === true ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            ) : f.value === false ? (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <span className="text-muted-foreground">
              {translateFeatureName(t, f.name)}
              {typeof f.value === 'string' && (
                <span className="text-foreground">: {translateFeatureValue(t, f.value)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PricingPage() {
  const t = useTranslations('pricing')
  const tCommon = useTranslations('common')

  useScrollReveal()

  const faqs = getFaqs(t)

  useEffect(() => {
    trackPageView('landing', { variant: 'pricing' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'pricing' })
  }, [])

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="link" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <SectionHeader
              label={t.title}
              title={
                <>
                  {t.heroTitle1}{' '}
                  <span className="text-gradient">{t.heroTitle2}</span>
                </>
              }
              description={t.heroSubtitle}
            />
            <div className="mt-8">
              <TrustStrip
                items={[
                  { icon: Check, text: tCommon.noAppRequired },
                  { icon: Sparkles, text: tCommon.instantSetup },
                  { icon: Users, text: tCommon.unlimitedGuests },
                  { icon: Heart, text: tCommon.freeForever },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Event-based Tiers */}
      <section className="relative pb-10">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal flex items-center gap-3 mb-8">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                <Calendar className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">{t.payPerEvent}</h2>
                <p className="text-xs text-muted-foreground">{t.payPerEventSubtitle}</p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {eventTiers.map((tier, i) => (
                <TierCard key={tier.id} tier={tier} index={i} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recurring Tiers */}
      <section className="relative pb-16 sm:pb-24">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal flex items-center gap-3 mb-8 mt-10 pt-10 border-t border-border">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                <Briefcase className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">{t.payMonthly}</h2>
                <p className="text-xs text-muted-foreground">{t.payMonthlySubtitle}</p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {recurringTiers.map((tier, i) => (
                <TierCard key={tier.id} tier={tier} index={i} delayOffset={eventTiers.length} />
              ))}
              {/* Spacer for alignment on desktop */}
              <div className="hidden lg:block" />
            </div>
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <SectionHeader
              title={t.comparePlans}
              description={t.compareDesc}
            />
          </div>

          <div className="mx-auto mt-12 max-w-4xl reveal overflow-x-auto">
            <div className="min-w-[700px] overflow-hidden rounded-xl border border-border bg-background">
              <div className="grid grid-cols-[1.75fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-border bg-surface px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>{t.feature}</span>
                <span className="text-center">{t.free}</span>
                <span className="text-center text-foreground font-semibold">{t.proEvent}</span>
                <span className="text-center">{t.weddingPro}</span>
                <span className="text-center">{t.professional}</span>
                <span className="text-center">{t.business}</span>
              </div>
              {allTiers[0].features.map((f) => (
                <div
                  key={f.name}
                  className="grid grid-cols-[1.75fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3 text-sm border-b border-border last:border-0 even:bg-surface"
                >
                  <span className="text-muted-foreground">{translateFeatureName(t, f.name)}</span>
                  {allTiers.map((tier) => {
                    const feature = tier.features.find((tf) => tf.name === f.name)
                    return (
                      <div key={tier.id} className="text-center">
                        <FeatureValue value={feature?.value} />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Guest Access Clarification */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal rounded-2xl border border-primary/20 bg-primary/5 p-8 sm:p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary mx-auto">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {t.guestsAlwaysFree}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.noHiddenFees} {t.noSurprises} {t.onlyPriceYouPay}
            </p>
          </div>
        </div>
      </section>

      {/* Target Landing Page Links */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <SectionHeader
              title={t.findRightPlan}
              description={t.exploreGuides}
            />
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: '/wedding-photo-sharing', label: t.weddings, icon: Heart },
              { href: '/birthday-photo-sharing', label: t.birthdays, icon: Sparkles },
              { href: '/private-party-photo-sharing', label: t.privateParties, icon: Calendar },
              { href: '/corporate-event-photo-sharing', label: t.corporateEvents, icon: Briefcase },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="reveal group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-surface p-4 hover:border-primary/20 transition-all duration-200"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <link.icon className="h-5 w-5" />
                </div>
                <span className="font-display text-sm font-semibold text-foreground">{link.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Professional CTA Band */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal surface-elevated rounded-2xl p-8 sm:p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary mx-auto">
              <Briefcase className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {t.runningProfessionally}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.proCtaDesc}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild className="cta-primary">
                <a href="/for-wedding-photographers">
                  {t.forPhotographers}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" className="border-border bg-transparent hover:bg-surface" asChild>
                <a href="/for-event-planners">{t.forPlanners}</a>
              </Button>
              <Button variant="outline" className="border-border bg-transparent hover:bg-surface" asChild>
                <a href="/commercial-license">{t.commercialLicense}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl">
            <div className="text-center reveal">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface border border-border text-primary mx-auto">
                <HelpCircle className="h-6 w-6" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {t.faqTitle}
              </h2>
            </div>

            <div className="mt-10 space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="reveal rounded-xl border border-border bg-surface p-5 sm:p-6"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <h3 className="font-display text-sm font-semibold text-foreground">{faq.q}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative pb-16 sm:pb-24">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl reveal surface-elevated rounded-2xl p-8 sm:p-10 text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {t.readyToCollect}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t.createFirstRoomCta}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="cta-primary" asChild>
                <a href="/">{t.createFreeRoom}</a>
              </Button>
              <Button size="lg" variant="outline" className="border-border bg-transparent hover:bg-surface" asChild>
                <a href="/dashboard/login">{t.signInToUpgrade}</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
