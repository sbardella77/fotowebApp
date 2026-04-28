'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera,
  Heart,
  QrCode,
  Users,
  ImagePlus,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Download,
  Shield,
  Lock,
  Infinity,
  Briefcase,
  EyeOff,
  Smartphone,
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

export function PhotographersLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'photographers' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'photographers' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'photographers',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'photographers',
    })

    setIsCreating(true)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, ownerEmail: trimmedEmail }),
      })
      const payload = await response.json()
      if (response.ok && payload.event?.slug) {
        router.push(`/event/${payload.event.slug}?new=1`)
      }
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
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary animate-fade-up">
              For Wedding Photographers
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              Your clients&apos; guests.{' '}
              <span className="text-gradient">Their photos. Your brand.</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Offer private photo collection as part of your wedding packages.
              Guests upload instantly via QR code — no app, no signup, no social media noise.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground animate-fade-up delay-300">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Unlimited rooms with Pro
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Bulk download all photos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Private by default
              </span>
            </div>
          </div>

          {/* Create Form */}
          <div id="create" className="mx-auto mt-12 max-w-lg animate-fade-up delay-400">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
              <div className="space-y-3">
                <Input
                  placeholder="Client name or event title"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                  className="h-12 rounded-lg border-white/[0.07] bg-[#0D1220]"
                />
                <Input
                  placeholder="Your email"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                  className="h-12 rounded-lg border-white/[0.07] bg-[#0D1220]"
                />
                <Button
                  className="h-12 w-full glow-blue"
                  onClick={createEvent}
                  disabled={isCreating}
                >
                  {isCreating ? (
                    'Creating...'
                  ) : (
                    <>
                      Create your first room
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Free to start. Upgrade to Pro for unlimited rooms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / Solution */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal">
              <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                The photos your clients never see
              </h2>
              <p className="mt-4 text-muted-foreground">
                After you deliver the gallery, guests keep snapping photos on their phones.
                Those moments — the dance floor, the candid laughter, the behind-the-scenes —
                are scattered across dozens of devices and never make it back to the couple.
              </p>
              <p className="mt-3 text-muted-foreground">
                Social media hashtags miss half the guests. AirDrop chains break. Group chats
                get buried. You deliver beautiful photos, but the full story stays fragmented.
              </p>
            </div>
            <div className="reveal space-y-4" style={{ transitionDelay: '100ms' }}>
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <QrCode className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  One QR code, every guest photo
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Place a QR card on the welcome table or print it on your stationery.
                  Guests scan, upload, and every photo appears in one private gallery.
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <Download className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  Download everything in one click
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  After the event, download the full guest photo collection in original
                  resolution. Deliver it to your clients as a bonus — or keep it for your portfolio.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Built for professionals
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Tools that earn you more trust
            </h2>
            <p className="mt-3 text-muted-foreground">
              Every feature designed to make you look sharper and your clients feel cared for.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Infinity,
                title: 'Unlimited rooms',
                desc: 'Run one wedding or twenty. Every client gets their own private space.',
              },
              {
                icon: Lock,
                title: 'Private by default',
                desc: 'No public feeds, no social media noise. Just the couple and their guests.',
              },
              {
                icon: Download,
                title: 'Bulk download',
                desc: 'Grab every guest photo in original resolution with a single click.',
              },
              {
                icon: EyeOff,
                title: 'Photo moderation',
                desc: 'Review and approve photos before they appear in the gallery.',
              },
              {
                icon: Smartphone,
                title: 'No app needed',
                desc: 'Guests upload straight from their camera roll in seconds.',
              },
              {
                icon: Briefcase,
                title: 'Commercial use allowed',
                desc: 'Use SnapRooms as part of your paid packages. No extra licensing fees.',
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card hover:-translate-y-px hover:border-white/[0.12] transition-all duration-200"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              How it works
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Three steps to a better client experience
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Create a room',
                desc: 'Set up a private photo room for each client in seconds. Name it after the couple.',
              },
              {
                step: '02',
                title: 'Share the QR code',
                desc: 'Print the QR card or share the link with the couple to include in their invites.',
              },
              {
                step: '03',
                title: 'Collect & deliver',
                desc: 'Guest photos appear in real time. Download the full collection and deliver it as a surprise bonus.',
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className="reveal relative rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 text-center shadow-card"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <span className="font-mono text-3xl font-bold text-primary/20">
                  {item.step}
                </span>
                <h3 className="mt-3 font-display text-base font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl reveal">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 sm:p-10 shadow-card text-center">
              <Sparkles className="mx-auto h-6 w-6 text-primary" />
              <blockquote className="mt-5 font-display text-lg font-medium text-white sm:text-xl">
                &ldquo;I started including a SnapRooms QR code in every wedding package.
                Clients love getting the guest photos afterward — it sets me apart from
                every other photographer in my market.&rdquo;
              </blockquote>
              <p className="mt-4 text-sm text-muted-foreground">
                — Sarah, wedding photographer, Portland
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              One simple plan for professionals
            </h2>
            <p className="mt-3 text-muted-foreground">
              No per-event fees. No guest limits. One flat monthly rate for everything you need.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-md reveal">
            <div className="rounded-2xl border border-primary/20 bg-[#141C2E] p-8 shadow-card">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                  Pro
                </span>
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-white">$9</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Unlimited rooms, permanent galleries, bulk downloads, and priority support.
              </p>
              <Button className="mt-6 w-full glow-blue" asChild>
                <a href="/dashboard/login">
                  Start your Pro trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <ul className="mt-6 space-y-2 text-sm">
                {[
                  'Unlimited client rooms',
                  'Permanent galleries',
                  'Bulk photo download',
                  'Advanced moderation',
                  'Remove SnapRooms branding',
                  'Priority email support',
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
            Need custom terms for your studio or agency?{' '}
            <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative pb-16 sm:pb-24">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Give your clients the full story
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your first room in seconds. See why photographers are making photo
              collection part of every package.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="glow-blue" asChild>
                <a href="/">Create free room</a>
              </Button>
              <Button size="lg" variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/pricing">View pricing</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
