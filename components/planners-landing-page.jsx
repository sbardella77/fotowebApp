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
  CalendarDays,
  Smartphone,
  BarChart3,
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

export function PlannersLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'planners' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'planners' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'planners',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'planners',
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
              For Event Planners
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              Every event.{' '}
              <span className="text-gradient">One dashboard. All the photos.</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Stop chasing guests for photos after every event. Create a room, share a QR code,
              and collect every moment in real time — across weddings, corporate events, and private parties.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground animate-fade-up delay-300">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Multi-event dashboard
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Guest photos in real time
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Deliver galleries to clients
              </span>
            </div>
          </div>

          {/* Create Form */}
          <div id="create" className="mx-auto mt-12 max-w-lg animate-fade-up delay-400">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
              <div className="space-y-3">
                <Input
                  placeholder="Event name"
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
                Free to start. Upgrade to Pro for unlimited events.
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
                The post-event photo scramble
              </h2>
              <p className="mt-4 text-muted-foreground">
                After a flawless event, you spend days hunting down guest photos.
                Text threads go cold. Email attachments bounce. Social hashtags miss
                half the attendees. Your client asks for a photo album and you
                have nothing but your own shots.
              </p>
              <p className="mt-3 text-muted-foreground">
                That gap between the event and the final deliverable? It is where
                client satisfaction lives or dies.
              </p>
            </div>
            <div className="reveal space-y-4" style={{ transitionDelay: '100ms' }}>
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <QrCode className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  QR codes that just work
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Print QR cards for table settings, welcome desks, or digital signage.
                  Guests scan and upload in seconds — no app, no account, no friction.
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <CalendarDays className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-white">
                  One dashboard, every event
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Manage all your events from a single screen. Create rooms for
                  multiple clients, switch between them instantly, and never lose track.
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
              Everything you need
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Built for planners who deliver
            </h2>
            <p className="mt-3 text-muted-foreground">
              From corporate galas to intimate weddings — the tools to collect, manage, and share photos effortlessly.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Infinity,
                title: 'Unlimited events',
                desc: 'Run as many events as you book. Each gets its own room, gallery, and QR code.',
              },
              {
                icon: QrCode,
                title: 'Instant QR sharing',
                desc: 'Generate a QR code for every event. Print it, display it, or send it digitally.',
              },
              {
                icon: Smartphone,
                title: 'Zero guest friction',
                desc: 'Guests open, upload, and done. No downloads, no accounts, no learning curve.',
              },
              {
                icon: Download,
                title: 'Client-ready downloads',
                desc: 'Download every photo in full resolution and deliver a complete gallery to your client.',
              },
              {
                icon: Lock,
                title: 'Private & secure',
                desc: 'Every room is private by default. Only invited guests see the photos.',
              },
              {
                icon: Briefcase,
                title: 'Commercial use included',
                desc: 'Use SnapRooms as part of your planning services. No additional licensing fees.',
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

      {/* Use Cases */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Use cases
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Every event you plan
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              {
                icon: Heart,
                title: 'Weddings',
                desc: 'Collect guest photos from the ceremony to the last dance. Deliver the full story to the couple.',
              },
              {
                icon: Briefcase,
                title: 'Corporate events',
                desc: 'Gather candid moments from conferences, galas, and team offsites. Share internally or with stakeholders.',
              },
              {
                icon: Sparkles,
                title: 'Private parties',
                desc: 'Birthdays, anniversaries, reunions — give hosts a complete guest photo collection they will treasure.',
              },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold text-white">
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
                &ldquo;I used to spend three days after every wedding begging guests for photos.
                Now I add a SnapRooms QR code to my welcome packets and the gallery
                fills itself. My clients are amazed.&rdquo;
              </blockquote>
              <p className="mt-4 text-sm text-muted-foreground">
                — Maria, event planner, Austin
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
              One plan. Every event you book.
            </h2>
            <p className="mt-3 text-muted-foreground">
              No per-event fees. No surprise charges. Scale from one event to fifty without changing your tool.
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
                  'Unlimited event rooms',
                  'Permanent galleries',
                  'Bulk photo download',
                  'Photo moderation',
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
            Planning events for a venue or agency?{' '}
            <a href="mailto:hello@snaprooms.app" className="text-primary hover:underline">
              Contact us for custom terms
            </a>
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative pb-16 sm:pb-24">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl text-center reveal">
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Deliver more than the event
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your first room in seconds. See why planners are making guest
              photo collection part of every proposal.
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
