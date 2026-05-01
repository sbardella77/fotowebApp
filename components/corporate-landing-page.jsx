'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera,
  Heart,
  PartyPopper,
  QrCode,
  Users,
  ImagePlus,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Smartphone,
  Download,
  Building2,
  Briefcase,
  Presentation,
  Shield,
  Lock,
  Globe,
  Monitor,
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

export function CorporateLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'corporate' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'corporate' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'corporate',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'corporate',
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
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary animate-fade-up">
              Corporate Event Photo Collection
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              Every attendee photo.{' '}
              <span className="text-gradient">One professional gallery.</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Collect photos from conferences, offsites, and company events with a simple
              QR code. No app installs, no IT setup, no training required.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground animate-fade-up delay-300">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Zero IT overhead
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Unlimited attendees
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Enterprise privacy
              </span>
            </div>
          </div>

          {/* Create Form */}
          <div id="create" className="mx-auto mt-12 max-w-lg animate-fade-up delay-400">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
              <div className="space-y-3">
                <Input
                  placeholder="Event or company name"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createEvent()}
                  className="h-12 rounded-lg border-white/[0.07] bg-[#0D1220]"
                />
                <Input
                  placeholder="Your work email"
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
                      Create your event room
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Free to start. No IT approval required.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-2 sm:items-center">
            <div className="reveal">
              <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Your event has one photographer. Your attendees have hundreds.
              </h2>
              <p className="mt-4 text-muted-foreground">
                Professional event photography captures the stage. But the real energy —
                the networking moments, the candid reactions, the team selfies — lives on
                your attendees&apos; phones. Those photos are lost the moment the event ends.
              </p>
              <p className="mt-3 text-muted-foreground">
                Marketing teams scramble for authentic visuals. Internal comms begs for
                photos. And the best shots? They disappear into personal camera rolls.
              </p>
            </div>
            <div className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card" style={{ transitionDelay: '100ms' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                <Presentation className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                Crowdsource your event photography
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Give every attendee the ability to contribute to the official event gallery.
                One QR code. Zero IT tickets. A complete visual record from every perspective.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              How it works
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Three steps to complete event coverage
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Create an event room',
                desc: 'Name it after your conference or offsite. No IT setup, no software installation.',
              },
              {
                step: '02',
                title: 'Display the QR code',
                desc: 'Add it to slides, print it for signage, or share it in your event app. Attendees scan and go.',
              },
              {
                step: '03',
                title: 'Collect & download',
                desc: 'Photos appear in real time. Download the full gallery for marketing, internal comms, or archives.',
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

      {/* Why Corporate */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Built for professional events
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Why event professionals choose SnapRooms
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Building2,
                title: 'Zero IT overhead',
                desc: 'No software to deploy, no firewall rules to configure, no help desk tickets. Works on any device instantly.',
              },
              {
                icon: Globe,
                title: 'Works for any event size',
                desc: 'From 20-person team lunches to 2,000-person conferences. One room scales to any crowd.',
              },
              {
                icon: Monitor,
                title: 'Display-ready galleries',
                desc: 'Project the live gallery on screens at the venue. Let attendees see the event build itself in real time.',
              },
              {
                icon: Smartphone,
                title: 'No attendee friction',
                desc: 'Guests scan, open, upload. No app store visits, no corporate login portals, no training required.',
              },
              {
                icon: Lock,
                title: 'Private & secure',
                desc: 'Invitation-only access. No public indexing. Photos belong to your organization, not a social platform.',
              },
              {
                icon: Download,
                title: 'Bulk download & archive',
                desc: 'Download the complete gallery in original resolution. Perfect for marketing assets, year-end recaps, and archives.',
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
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Use cases
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Events that benefit from every angle
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              {
                icon: Briefcase,
                title: 'Conferences & summits',
                desc: 'Capture session reactions, networking moments, and booth interactions from every attendee perspective.',
              },
              {
                icon: Users,
                title: 'Team offsites',
                desc: 'Build a shared visual record of team building, workshops, and celebrations. Strengthen culture through imagery.',
              },
              {
                icon: PartyPopper,
                title: 'Company celebrations',
                desc: 'Holiday parties, milestone events, and launch celebrations — documented by the people who make them special.',
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

      {/* QR Section */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal grid gap-10 sm:grid-cols-2 sm:items-center">
              <div>
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                  QR Code Deployment
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  One QR code. Every department. All the photos.
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Integrate the QR code into your event slides, print it on welcome
                  signage, or embed it in your event app. Attendees scan with any
                  smartphone and upload photos instantly.
                </p>
                <p className="mt-3 text-muted-foreground">
                  No corporate app store approvals. No device management. No IT
                  intervention. It just works — on every phone, in every region,
                  without exception.
                </p>
              </div>
              <div className="reveal flex justify-center" style={{ transitionDelay: '100ms' }}>
                <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 shadow-card">
                  <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-[#0D1220] border border-white/[0.07]">
                    <QrCode className="h-20 w-20 text-primary" />
                  </div>
                  <p className="mt-4 text-center text-sm font-medium text-white">
                    Scan to upload event photos
                  </p>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    No app installation required
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary mx-auto shadow-card">
              <Shield className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Enterprise-grade privacy, zero enterprise complexity
            </h2>
            <p className="mt-3 text-muted-foreground">
              Your event photos are business assets. We treat them that way.
              No public feeds, no third-party data sharing, no surprises.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              { title: 'GDPR compliant', desc: 'Built with data protection principles from the ground up.' },
              { title: 'Encrypted storage', desc: 'Photos stored securely at rest and in transit.' },
              { title: 'You own your content', desc: 'Full download rights. Delete anytime. No lock-in.' },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal rounded-xl border border-white/[0.07] bg-[#141C2E] p-5 text-center shadow-card"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <h3 className="font-display text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl">
            <div className="text-center reveal">
              <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Frequently asked questions
              </h2>
            </div>

            <div className="mt-10 reveal">
              <Accordion type="single" collapsible className="space-y-3">
                {[
                  {
                    q: 'Do attendees need to install an app or create an account?',
                    a: 'No. Attendees scan the QR code or open the link in their mobile browser and upload photos directly from their camera roll. No app store, no registration, no corporate SSO.',
                  },
                  {
                    q: 'Can we use this for large conferences with thousands of attendees?',
                    a: 'Yes. SnapRooms handles events of any size. There are no attendee limits and no per-person fees.',
                  },
                  {
                    q: 'Is the gallery private? Can the public find it?',
                    a: 'Completely private. Each room has a unique, unguessable URL. Galleries are not indexed by search engines and cannot be discovered without the direct link.',
                  },
                  {
                    q: 'Can we download all photos for marketing or internal use?',
                    a: 'Yes. Room owners can download the entire gallery in original resolution with a single click on premium plans and unlocked rooms. Free rooms include standard-quality downloads; original quality unlocks for a one-time €1.99 fee.',
                  },
                  {
                    q: 'How long are galleries available?',
                    a: 'Free galleries remain active for 7 days. Pro plans offer permanent galleries with no expiration.',
                  },
                  {
                    q: 'Do you offer invoicing or enterprise agreements?',
                    a: 'Yes. We offer invoicing, volume pricing, and custom terms for organizations. Contact us at hello@snaprooms.app to discuss your requirements.',
                  },
                ].map((faq, i) => (
                  <AccordionItem
                    key={i}
                    value={`item-${i}`}
                    className="rounded-xl border border-white/[0.07] bg-[#141C2E] px-5 shadow-card"
                  >
                    <AccordionTrigger className="text-left text-sm font-semibold text-white hover:no-underline">
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
            <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Capture every angle of your next event
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your event room in seconds and give every attendee a voice —
              and a camera.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="glow-blue" asChild>
                <a href="/">Create free event room</a>
              </Button>
              <Button size="lg" variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/pricing">View pricing</a>
              </Button>
            </div>
            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              No IT setup required. Works on any device.
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
