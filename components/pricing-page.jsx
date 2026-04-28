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
  Mail,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarketingNav } from '@/components/marketing-nav'
import { MarketingFooter } from '@/components/marketing-footer'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW } from '@/lib/analytics/events'

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
      { name: 'Full downloads', value: false },
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
    description: 'Unlock unlimited photos, full downloads, and a premium experience for one special event.',
    cta: { label: 'Upgrade this event', href: '/dashboard/login', variant: 'primary' },
    features: [
      { name: 'Active rooms', value: '1 premium' },
      { name: 'Photo limit', value: 'Unlimited' },
      { name: 'Guest uploads', value: true },
      { name: 'QR code sharing', value: true },
      { name: 'Full downloads', value: true },
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
      { name: 'Full downloads', value: true },
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
      { name: 'Full downloads', value: true },
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
      { name: 'Full downloads', value: true },
      { name: 'SnapRooms branding removed', value: true },
      { name: 'Wedding-focused premium experience', value: true },
      { name: 'Commercial use', value: true },
      { name: 'Priority support', value: 'Dedicated' },
      { name: 'Custom setup', value: true },
    ],
  },
]

const allTiers = [...eventTiers, ...recurringTiers]

const faqs = [
  {
    q: 'Can I really use SnapRooms for free?',
    a: 'Yes. The free plan gives you one active room and up to 50 photos. It is perfect for trying SnapRooms or hosting a small casual event. Guests always upload for free — they never pay.',
  },
  {
    q: 'What is the difference between Pro Event and Wedding Pro?',
    a: 'Both are one-time per-event purchases with unlimited photos and guests. Wedding Pro adds wedding-specific QR signage assets, longer post-event gallery access, and a premium experience tailored for weddings.',
  },
  {
    q: 'Do guests need to sign up or install an app?',
    a: 'No. Guests simply scan your QR code or open your room link and upload photos instantly from any phone. Zero friction, zero downloads, zero cost.',
  },
  {
    q: 'Why is Professional priced monthly instead of per event?',
    a: 'Professional is built for photographers, planners, and venues who run events repeatedly for clients. A monthly subscription keeps costs predictable as you scale from one client event to the next.',
  },
  {
    q: 'Can I use SnapRooms as part of my paid photography or planning services?',
    a: 'Yes. The Professional and Business plans include commercial use rights. You can create rooms for clients, deliver galleries, and include SnapRooms as part of your service packages.',
  },
  {
    q: 'Do you offer custom pricing for agencies or corporate teams?',
    a: 'Yes. Our Business tier is designed for organizations that need volume pricing, invoicing, or custom terms. Contact us at hello@snaprooms.app and we will reply within one business day.',
  },
]

function FeatureValue({ value }) {
  if (value === true) {
    return <Check className="h-4 w-4 text-emerald-400 mx-auto" />
  }
  if (value === false) {
    return <Minus className="h-4 w-4 text-muted-foreground/40 mx-auto" />
  }
  return <span className="text-sm text-muted-foreground">{value}</span>
}

function TierCard({ tier, index, delayOffset = 0 }) {
  return (
    <div
      className={`reveal relative flex flex-col rounded-2xl border p-6 shadow-card ${
        tier.badge === 'Most popular'
          ? 'border-primary/20 bg-[#141C2E]'
          : 'border-white/[0.07] bg-[#141C2E]'
      }`}
      style={{ transitionDelay: `${(index + delayOffset) * 60}ms` }}
    >
      {tier.badge && (
        <div className="absolute -top-3 left-5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
              tier.badge === 'Most popular'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-white/[0.07] bg-[#0D1220] text-muted-foreground'
            }`}
          >
            {tier.badge === 'Most popular' && <Sparkles className="h-3 w-3" />}
            {tier.badge}
          </span>
        </div>
      )}

      <div className="mt-2">
        <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {tier.target}
        </span>
        <h3 className="mt-2 font-display text-lg font-bold text-white">{tier.name}</h3>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-3xl font-bold text-white">{tier.price}</span>
        {tier.interval && <span className="text-sm text-muted-foreground">{tier.interval}</span>}
      </div>

      {tier.secondaryPrice && (
        <p className="mt-1 text-xs text-muted-foreground">
          or <span className="text-foreground">{tier.secondaryPrice}</span> (save 17%)
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tier.description}</p>

      <div className="mt-5">
        {tier.cta.variant === 'primary' ? (
          <Button className="w-full glow-blue" size="sm" asChild>
            <a href={tier.cta.href}>
              {tier.cta.label}
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full border-white/[0.07] bg-transparent hover:bg-white/[0.03]"
            size="sm"
            asChild
          >
            <a href={tier.cta.href}>{tier.cta.label}</a>
          </Button>
        )}
      </div>

      <ul className="mt-6 space-y-2.5">
        {tier.features.map((f) => (
          <li key={f.name} className="flex items-start gap-2.5 text-sm">
            {f.value === true ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            ) : f.value === false ? (
              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
            ) : (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <span className="text-muted-foreground">
              {f.name}
              {typeof f.value === 'string' && (
                <span className="text-foreground">: {f.value}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PricingPage() {
  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'pricing' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'pricing' })
  }, [])

  return (
    <div className="dark relative min-h-screen bg-background font-body text-foreground">
      <div className="noise-overlay" aria-hidden="true" />
      <MarketingNav ctaAction="link" />

      {/* Hero */}
      <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="absolute inset-0 bg-grid opacity-50" aria-hidden="true" />
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary animate-fade-up">
              Pricing
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              Simple pricing for{' '}
              <span className="text-gradient">every kind of event</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Guests always upload for free. You only pay if you want more rooms,
              more photos, and premium event tools.
            </p>
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
                <h2 className="font-display text-base font-semibold text-white">Pay per event</h2>
                <p className="text-xs text-muted-foreground">For personal celebrations and one-off occasions</p>
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
            <div className="reveal flex items-center gap-3 mb-8 mt-10 pt-10 border-t border-white/[0.07]">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                <Briefcase className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-white">Pay monthly</h2>
                <p className="text-xs text-muted-foreground">For professionals and businesses who run events regularly</p>
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
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Compare all plans
            </h2>
            <p className="mt-3 text-muted-foreground">
              Pick the plan that fits your event. Upgrade or downgrade anytime.
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-4xl reveal overflow-x-auto">
            <div className="min-w-[700px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#141C2E]">
              <div className="grid grid-cols-[1.75fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-white/[0.07] px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>Feature</span>
                <span className="text-center">Free</span>
                <span className="text-center text-primary">Pro Event</span>
                <span className="text-center">Wedding Pro</span>
                <span className="text-center">Professional</span>
                <span className="text-center">Business</span>
              </div>
              {allTiers[0].features.map((f) => (
                <div
                  key={f.name}
                  className="grid grid-cols-[1.75fr_1fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3 text-sm border-b border-white/[0.04] last:border-0"
                >
                  <span className="text-muted-foreground">{f.name}</span>
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
          <div className="mx-auto max-w-3xl reveal rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 sm:p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto">
              <Users className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
              Guests always upload for free
            </h2>
            <p className="mt-3 text-muted-foreground">
              No matter which plan you choose, your guests never pay to upload photos.
              There are no hidden fees, no guest limits, and no surprise charges.
              The price you see is the only price you pay.
            </p>
          </div>
        </div>
      </section>

      {/* Target Landing Page Links */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Find the right plan for your event
            </h2>
            <p className="mt-3 text-muted-foreground">
              Explore event-specific guides to see how SnapRooms fits your occasion.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: '/wedding-photo-sharing', label: 'Weddings', icon: Heart },
              { href: '/birthday-photo-sharing', label: 'Birthdays', icon: Sparkles },
              { href: '/private-party-photo-sharing', label: 'Private Parties', icon: Calendar },
              { href: '/corporate-event-photo-sharing', label: 'Corporate Events', icon: Briefcase },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="reveal group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#141C2E] p-4 shadow-card hover:border-white/[0.12] transition-all duration-200"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                  <link.icon className="h-5 w-5" />
                </div>
                <span className="font-display text-sm font-semibold text-white">{link.label}</span>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Professional CTA Band */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 sm:p-10 text-center shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary mx-auto">
              <Briefcase className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
              Running events professionally?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Photographers, planners, and venues use SnapRooms Professional and
              Business tiers to deliver a premium photo-collection experience to clients.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild className="glow-blue">
                <a href="/for-wedding-photographers">
                  For Photographers
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/for-event-planners">For Planners</a>
              </Button>
              <Button variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/commercial-license">Commercial License</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl">
            <div className="text-center reveal">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary mx-auto shadow-card">
                <HelpCircle className="h-6 w-6" />
              </div>
              <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Frequently asked questions
              </h2>
            </div>

            <div className="mt-10 space-y-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-5 sm:p-6"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <h3 className="font-display text-sm font-semibold text-white">{faq.q}</h3>
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
          <div className="mx-auto max-w-2xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Ready to collect every guest photo?
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your first room in seconds. No credit card required.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="glow-blue" asChild>
                <a href="/">Create free room</a>
              </Button>
              <Button size="lg" variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/dashboard/login">Sign in to upgrade</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
