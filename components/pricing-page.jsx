'use client'

import { useEffect } from 'react'
import {
  Check,
  Minus,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  HelpCircle,
  Briefcase,
  Heart,
  Calendar,
  Users,
  Clock,
  Camera,
  Building2,
  PartyPopper,
  Zap,
  QrCode,
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
    benefits: ['freeBenefit1', 'freeBenefit2', 'freeBenefit3', 'freeBenefit4'],
    storageKey: 'freeBenefit5',
    features: [
      { name: 'Active events', value: '1' },
      { name: 'Guest upload', value: true },
      { name: 'QR / public event link', value: true },
      { name: 'SnapRooms branding', value: 'On downloads' },
      { name: 'Single photo download', value: true },
      { name: 'Full gallery ZIP download', value: false },
      { name: 'Private delivery', value: false },
      { name: 'Photographer upload link', value: false },
      { name: 'Analytics', value: false },
      { name: 'Professional workspace', value: false },
      { name: 'Storage duration', value: '90 days' },
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
    benefits: ['proEventBenefit1', 'proEventBenefit2', 'proEventBenefit3'],
    storageKey: 'proEventBenefit4',
    features: [
      { name: 'Active events', value: '1 premium' },
      { name: 'Guest upload', value: true },
      { name: 'QR / public event link', value: true },
      { name: 'SnapRooms branding', value: 'Removed' },
      { name: 'Single photo download', value: true },
      { name: 'Full gallery ZIP download', value: true },
      { name: 'Private delivery', value: false },
      { name: 'Photographer upload link', value: false },
      { name: 'Analytics', value: false },
      { name: 'Professional workspace', value: false },
      { name: 'Storage duration', value: '12 months' },
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
    benefits: ['weddingProBenefit1', 'weddingProBenefit2', 'weddingProBenefit3', 'weddingProBenefit4'],
    storageKey: 'weddingProBenefit5',
    features: [
      { name: 'Active events', value: '1 premium' },
      { name: 'Guest upload', value: true },
      { name: 'QR / public event link', value: true },
      { name: 'SnapRooms branding', value: 'Removed' },
      { name: 'Single photo download', value: true },
      { name: 'Full gallery ZIP download', value: true },
      { name: 'Private delivery', value: true },
      { name: 'Photographer upload link', value: true },
      { name: 'Analytics', value: false },
      { name: 'Professional workspace', value: false },
      { name: 'Storage duration', value: '24 months' },
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
    target: 'Photographers, planners, venues',
    description: 'Run multiple events for multiple clients. Commercial use included. Built for professionals who rely on SnapRooms every week.',
    cta: { label: 'Start Professional', href: '/dashboard/login', variant: 'outline' },
    benefits: ['professionalBenefit1', 'professionalBenefit2', 'professionalBenefit3', 'professionalBenefit4'],
    storageKey: 'professionalBenefit5',
    features: [
      { name: 'Active events', value: 'Multiple' },
      { name: 'Guest upload', value: true },
      { name: 'QR / public event link', value: true },
      { name: 'SnapRooms branding', value: 'Removed' },
      { name: 'Single photo download', value: true },
      { name: 'Full gallery ZIP download', value: true },
      { name: 'Private delivery', value: true },
      { name: 'Photographer upload link', value: true },
      { name: 'Analytics', value: true },
      { name: 'Professional workspace', value: true },
      { name: 'Storage duration', value: 'While active' },
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
    benefits: [],
    storageKey: null,
    features: [
      { name: 'Active events', value: 'Unlimited' },
      { name: 'Guest upload', value: true },
      { name: 'QR / public event link', value: true },
      { name: 'SnapRooms branding', value: 'Removed' },
      { name: 'Single photo download', value: true },
      { name: 'Full gallery ZIP download', value: true },
      { name: 'Private delivery', value: true },
      { name: 'Photographer upload link', value: true },
      { name: 'Analytics', value: true },
      { name: 'Professional workspace', value: true },
      { name: 'Storage duration', value: 'Custom' },
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
    { q: t.pricingFaq7Question, a: t.pricingFaq7Answer },
    { q: t.pricingFaq8Question, a: t.pricingFaq8Answer },
  ]
}

function FeatureValue({ value }) {
  const t = useTranslations('pricing')
  if (value === true) {
    return <Check className="h-4 w-4 text-primary mx-auto" />
  }
  if (value === false) {
    return <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />
  }
  return <span className="text-sm text-muted-foreground">{translateFeatureValue(t, value)}</span>
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
    'Active events': t.activeRooms,
    'Guest upload': t.guestUploads,
    'QR / public event link': t.qrPublicEventLink,
    'SnapRooms branding': t.snaproomsBranding,
    'Single photo download': t.singlePhotoDownload,
    'Full gallery ZIP download': t.fullGalleryDownloads,
    'Private delivery': t.privateDelivery,
    'Photographer upload link': t.photographerUploadLink,
    'Analytics': t.analytics,
    'Professional workspace': t.professionalWorkspace,
    'Storage duration': t.storageDuration,
    'Best for': t.bestFor,
  }
  return map[name] || name
}

function translateFeatureValue(t, value) {
  if (value === 'Multiple') return t.multiple
  if (value === 'Dedicated') return t.dedicated
  if (value === '90 days') return t.ninetyDays
  if (value === '12 months') return t.twelveMonths
  if (value === '24 months') return t.twentyFourMonths
  if (value === 'While active') return t.whileSubscriptionActive
  if (value === 'On downloads') return t.brandingOnDownloads
  if (value === 'Removed') return t.brandingRemovedValue
  if (value === 'Custom') return t.businessPrice
  return value
}

function TierCard({ tier, index, delayOffset = 0, isHighlighted = false }) {
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
        isHighlighted
          ? 'ring-2 ring-primary border-primary/40'
          : isPopular
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

      {tier.benefits.length > 0 && (
        <ul className="mt-6 space-y-2.5">
          {tier.benefits.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="text-muted-foreground">{t[b]}</span>
            </li>
          ))}
        </ul>
      )}

      {tier.storageKey && (
        <div className="mt-auto pt-5">
          <div className="flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
            <Clock className="h-4 w-4 shrink-0 text-primary" />
            <span>{t[tier.storageKey]}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function PricingPage({ fromDashboard, highlightPlan, eventSlug }) {
  const t = useTranslations('pricing')
  const tCommon = useTranslations('common')
  const tLanding = useTranslations('landing')
  const tMeta = useTranslations('meta')

  useScrollReveal()

  const faqs = getFaqs(t)

  useEffect(() => {
    trackPageView('landing', { variant: 'pricing' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'pricing' })
  }, [])

  // Scroll to highlighted tier section if plan is specified via query params
  useEffect(() => {
    if (!highlightPlan) return
    const isEventPlan = eventTiers.some((t) => t.id === highlightPlan)
    const section = isEventPlan
      ? document.querySelector('[data-pricing-section="event"]')
      : document.querySelector('[data-pricing-section="recurring"]')
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [highlightPlan])

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="link" />

      {fromDashboard && (
        <div className="container px-4 pt-6">
          <Button variant="outline" size="sm" asChild className="border-border bg-surface text-foreground hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent-dark">
            <a href="/dashboard">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              {tMeta.backToDashboard}
            </a>
          </Button>
        </div>
      )}

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
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                {t.forOneEvent}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1">
                <Briefcase className="h-3.5 w-3.5 text-primary" />
                {t.forManyEvents}
              </span>
            </div>
            <div className="mt-8">
              <TrustStrip
                items={[
                  { icon: Sparkles, text: tLanding.instantGallery },
                  { icon: Users, text: tLanding.unlimitedGuests },
                  { icon: Heart, text: tLanding.freeForever },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Event-based Tiers */}
      <section className="relative pb-10" data-pricing-section="event">
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
                <TierCard key={tier.id} tier={tier} index={i} isHighlighted={tier.id === highlightPlan} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recurring Tiers */}
      <section className="relative pb-16 sm:pb-24" data-pricing-section="recurring">
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
                <TierCard key={tier.id} tier={tier} index={i} delayOffset={eventTiers.length} isHighlighted={tier.id === highlightPlan} />
              ))}
              {/* Spacer for alignment on desktop */}
              <div className="hidden lg:block" />
            </div>
          </div>
        </div>
      </section>

      {/* Which plan is right for you? */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal text-center">
            <SectionHeader
              title={t.whichPlanTitle}
              description={t.whichPlanSubtitle}
            />
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
            {[
              { title: t.useCaseSmallPartyTitle, plan: t.useCaseSmallPartyPlan, copy: t.useCaseSmallPartyCopy, icon: PartyPopper },
              { title: t.useCaseWeddingTitle, plan: t.useCaseWeddingPlan, copy: t.useCaseWeddingCopy, icon: Heart },
              { title: t.useCasePhotographerTitle, plan: t.useCasePhotographerPlan, copy: t.useCasePhotographerCopy, icon: Camera },
              { title: t.useCaseCorporateTitle, plan: t.useCaseCorporatePlan, copy: t.useCaseCorporateCopy, icon: Building2 },
            ].map((item, i) => (
              <div
                key={i}
                className="reveal rounded-xl border border-white/[0.08] bg-surface p-5 sm:p-6"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-semibold text-foreground">{item.title}</h3>
                    <p className="text-xs font-medium text-primary">{item.plan}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="relative border-t border-border py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <SectionHeader
              title={t.comparePlans}
              description={t.compareDesc}
            />
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block mx-auto mt-12 max-w-5xl reveal overflow-x-auto">
            <div className="min-w-[800px] overflow-hidden rounded-xl border border-border bg-surface">
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

          {/* Mobile Comparison Cards */}
          <div className="md:hidden mx-auto mt-10 max-w-md space-y-6">
            {allTiers.map((tier) => (
              <div
                key={tier.id}
                className={`reveal rounded-xl border bg-surface p-5 ${
                  tier.id === highlightPlan ? 'ring-2 ring-primary border-primary/40' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-foreground">{translateTierName(t, tier)}</h3>
                  <div className="text-right">
                    <span className="font-display text-lg font-bold text-foreground">{tier.price}</span>
                    {tier.interval && (
                      <span className="block text-xs text-muted-foreground">{translateInterval(t, tier.interval)}</span>
                    )}
                  </div>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {tier.features.map((f) => (
                    <li key={f.name} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{translateFeatureName(t, f.name)}</span>
                      {f.value === true ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : f.value === false ? (
                        <Minus className="h-4 w-4 text-muted-foreground/40" />
                      ) : (
                        <span className="text-sm text-muted-foreground">{translateFeatureValue(t, f.value)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Soft Social Proof */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl reveal">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Zap, text: t.softProofLine1 },
                { icon: Users, text: t.softProofLine2 },
                { icon: QrCode, text: t.softProofLine3 },
                { icon: Briefcase, text: t.softProofLine4 },
              ].map((item, i) => (
                <div
                  key={i}
                  className="reveal flex flex-col items-center text-center rounded-xl border border-white/[0.08] bg-surface p-5"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{item.text}</p>
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

      {/* Professional CTA Band */}
      <section className="relative border-t border-border bg-surface py-16 sm:py-24">
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
      <section className="relative border-t border-border py-16 sm:py-24">
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

      {/* Vault Future Note */}
      <section className="relative pb-8 sm:pb-12">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal rounded-xl border border-dashed border-border bg-surface p-5 text-center">
            <p className="text-sm text-muted-foreground">{t.vaultFutureNote}</p>
          </div>
        </div>
      </section>

      {/* Extra Event Note */}
      <section className="relative pb-8 sm:pb-12">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal rounded-xl border border-dashed border-border bg-surface p-5 text-center">
            <p className="text-sm text-muted-foreground">{t.pricingExtraEventNote}</p>
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
