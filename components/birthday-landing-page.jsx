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
  Gift,
  Cake,
  Music,
  Shield,
  Lock,
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

export function BirthdayLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'birthday' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'birthday' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'birthday',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'birthday',
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
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-pink-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary animate-fade-up">
              Birthday Photo Sharing
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              Every candle.{' '}
              <span className="text-gradient">Every laugh. One room.</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Collect every birthday photo from your friends and family in one
              beautiful gallery. Share a QR code, let everyone upload instantly —
              no app, no signup, just pure fun.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground animate-fade-up delay-300">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Free forever
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Unlimited guests
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                No app needed
              </span>
            </div>
          </div>

          {/* Create Form */}
          <div id="create" className="mx-auto mt-12 max-w-lg animate-fade-up delay-400">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
              <div className="space-y-3">
                <Input
                  placeholder="Name's Birthday Bash"
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
                      Create your birthday room
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
              <p className="mt-3 text-center font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                Takes 10 seconds. No credit card required.
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
                The best photos never make it to the birthday person
              </h2>
              <p className="mt-4 text-muted-foreground">
                Your friends snap hundreds of photos — the candle blowout, the surprise
                face, the dance floor chaos. But those photos stay trapped in group chats,
                Instagram stories, and camera rolls you will never see.
              </p>
              <p className="mt-3 text-muted-foreground">
                By the time you think to ask, the moment has passed and the photos are
                buried under new messages.
              </p>
            </div>
            <div className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card" style={{ transitionDelay: '100ms' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                <Cake className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                One gallery for every birthday moment
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a room before the party, share the QR code on invitations or
                at the venue, and watch the gallery fill with candid shots from every
                guest. The birthday person gets every photo — not just the ones posted online.
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
              Three simple steps to a perfect birthday gallery
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Create a room',
                desc: 'Name it after the birthday star. Takes 10 seconds, no signup required.',
              },
              {
                step: '02',
                title: 'Share the QR code',
                desc: 'Add it to invitations, display it at the venue, or share the link in your group chat.',
              },
              {
                step: '03',
                title: 'Collect every moment',
                desc: 'Guests upload photos instantly. You get a complete gallery before the candles even cool.',
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

      {/* Why It Works for Birthdays */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Made for birthday celebrations
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Why birthdays love SnapRooms
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Gift,
                title: 'The perfect surprise gift',
                desc: 'Give the birthday person every photo from their special day — even the ones they never knew were taken.',
              },
              {
                icon: PartyPopper,
                title: 'Fun, not formal',
                desc: 'No stiff poses or staged shots. Just real, candid moments from the people who matter most.',
              },
              {
                icon: Music,
                title: 'Works during the party',
                desc: 'Guests upload while the music is still playing. The gallery builds itself in real time.',
              },
              {
                icon: Smartphone,
                title: 'Zero friction for guests',
                desc: 'Grandparents, kids, and everyone in between can upload without downloading anything.',
              },
              {
                icon: Lock,
                title: 'Private by default',
                desc: 'Only invited guests see the photos. No public feeds, no unwanted eyes.',
              },
              {
                icon: Download,
                title: 'Download everything',
                desc: 'Save the full gallery in original quality. Keep the memories forever.',
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

      {/* QR Code Section */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal grid gap-10 sm:grid-cols-2 sm:items-center">
              <div>
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                  QR Code Sharing
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  Share a QR code with your party guests
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Print a QR card for the cake table, add it to your invitation design,
                  or display it on a sign near the entrance. Guests scan, open, and upload
                  in seconds.
                </p>
                <p className="mt-3 text-muted-foreground">
                  Works on any phone — iPhone, Android, old or new. No app store visits.
                  No account creation. Just point, scan, and share.
                </p>
              </div>
              <div className="reveal flex justify-center" style={{ transitionDelay: '100ms' }}>
                <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 shadow-card">
                  <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-[#0D1220] border border-white/[0.07]">
                    <QrCode className="h-20 w-20 text-primary" />
                  </div>
                  <p className="mt-4 text-center text-sm font-medium text-white">
                    Scan to add your photos
                  </p>
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    No app needed
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Privacy */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary mx-auto shadow-card">
              <Shield className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Your birthday memories stay private
            </h2>
            <p className="mt-3 text-muted-foreground">
              No social media feeds. No public galleries. No data mining. Your birthday
              photos belong to you and your guests — period.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              { title: 'GDPR compliant', desc: 'We handle your data responsibly and transparently.' },
              { title: 'Encrypted storage', desc: 'Photos are stored securely and never sold.' },
              { title: 'You own your data', desc: 'Download everything or delete it anytime.' },
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
      <section className="relative py-16 sm:py-24">
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
                    q: 'Do my guests need to download an app?',
                    a: 'No. Guests simply scan the QR code or open the room link in their browser and upload photos directly from their camera roll. It works on any smartphone.',
                  },
                  {
                    q: 'Can I use this for a kid\'s birthday party?',
                    a: 'Absolutely. Parents can share the QR code with other parents and family members. Even grandparents can upload photos without any technical know-how.',
                  },
                  {
                    q: 'Is there a limit on how many photos guests can upload?',
                    a: 'No. Guests can upload as many photos as they like. There are no storage limits on free or Pro plans.',
                  },
                  {
                    q: 'Can I download all the photos after the party?',
                    a: 'Yes. On premium plans and unlocked rooms, you can download the entire gallery in original resolution with a single click. Free rooms include standard-quality downloads; original quality unlocks for a one-time €1.99 fee.',
                  },
                  {
                    q: 'How long does the gallery stay active?',
                    a: 'Free galleries are active for 7 days. Upgrade to Pro for permanent galleries that never expire.',
                  },
                  {
                    q: 'Is SnapRooms really free?',
                    a: 'Yes. You can create one birthday room, invite unlimited guests, and collect unlimited photos completely free. Pro plans unlock unlimited rooms and permanent galleries.',
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
              Do not miss a single birthday moment
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your birthday room in seconds and give the birthday star
              every photo from their special day.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="glow-blue" asChild>
                <a href="/">Create free birthday room</a>
              </Button>
              <Button size="lg" variant="outline" className="border-white/[0.07] bg-transparent hover:bg-white/[0.03]" asChild>
                <a href="/pricing">View pricing</a>
              </Button>
            </div>
            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              Takes 10 seconds. No credit card required.
            </p>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
