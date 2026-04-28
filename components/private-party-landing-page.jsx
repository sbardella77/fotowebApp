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
  Wine,
  Music,
  Flame,
  Shield,
  Lock,
  EyeOff,
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

export function PrivatePartyLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'private_party' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'private_party' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, {
      page_type: 'landing',
      variant: 'private_party',
      position: 'hero',
    })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'private_party',
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
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-violet-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary/5 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-block font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary animate-fade-up">
              Private Party Photo Sharing
            </span>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl animate-fade-up delay-100">
              The party starts here.{' '}
              <span className="text-gradient">The photos stay together.</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg animate-fade-up delay-200">
              Collect every photo from your private party in one place. Share a QR code,
              let guests upload instantly — no app, no signup, completely private.
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
                Completely private
              </span>
            </div>
          </div>

          {/* Create Form */}
          <div id="create" className="mx-auto mt-12 max-w-lg animate-fade-up delay-400">
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
              <div className="space-y-3">
                <Input
                  placeholder="Party name"
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
                      Create your party room
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
                The morning-after photo hunt
              </h2>
              <p className="mt-4 text-muted-foreground">
                You throw an amazing party. The next day, you want to see the photos.
                But they are everywhere — scattered across Instagram stories, Snapchat
                memories, WhatsApp chats, and camera rolls you will never access.
              </p>
              <p className="mt-3 text-muted-foreground">
                Some of the best moments were never posted. Some were shared in groups
                you are not in. The full story of the night? It is gone before brunch.
              </p>
            </div>
            <div className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card" style={{ transitionDelay: '100ms' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary shadow-card">
                <Flame className="h-6 w-6" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                One room. Every shot from the night.
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a private photo room before the party starts. Share the QR code
                at the door or in the group chat. Guests upload photos all night long.
                You wake up to a complete gallery — no chasing, no begging, no FOMO.
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
              Three steps to the perfect party gallery
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Create your room',
                desc: 'Name it after your party. Takes 10 seconds. No account needed to start.',
              },
              {
                step: '02',
                title: 'Share the link or QR',
                desc: 'Drop it in the group chat, print a card for the bar, or display it on a screen.',
              },
              {
                step: '03',
                title: 'Watch it fill up',
                desc: 'Guests upload photos in real time. You get the full story of the night, instantly.',
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

      {/* Why Private Parties */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
              Built for any gathering
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Why parties love SnapRooms
            </h2>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Wine,
                title: 'Works at any venue',
                desc: 'House party, rooftop bar, beach bonfire, or dinner club. The QR code works anywhere.',
              },
              {
                icon: Music,
                title: 'Real-time uploads',
                desc: 'Guests add photos while the night is still happening. The energy builds the gallery.',
              },
              {
                icon: EyeOff,
                title: 'Invite-only access',
                desc: 'Only people with the link see the photos. What happens at the party stays at the party.',
              },
              {
                icon: Smartphone,
                title: 'Zero friction',
                desc: 'No apps to download, no accounts to create. Open, upload, done.',
              },
              {
                icon: Lock,
                title: 'No social media noise',
                desc: 'Keep the photos private. No public hashtags, no unwanted tagging, no drama.',
              },
              {
                icon: Download,
                title: 'Download the night',
                desc: 'Save every photo in full resolution. Relive the best moments whenever you want.',
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

      {/* QR Section */}
      <section className="relative py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-5xl">
            <div className="reveal grid gap-10 sm:grid-cols-2 sm:items-center">
              <div>
                <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                  QR Code Sharing
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  One QR code. Every guest. All the photos.
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Print a card for the entry table, add it to your digital invite, or
                  flash it on the TV screen. Guests scan and upload in under 10 seconds.
                </p>
                <p className="mt-3 text-muted-foreground">
                  Works on every phone — even that one friend who still has an older model.
                  No app store. No updates. Just scan and go.
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

      {/* Trust */}
      <section className="relative border-t border-white/[0.07] bg-[#0D1220]/50 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center reveal">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#141C2E] border border-white/[0.07] text-primary mx-auto shadow-card">
              <Shield className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              What happens at the party stays private
            </h2>
            <p className="mt-3 text-muted-foreground">
              No public feeds. No data mining. No surprise tag notifications.
              Your party photos are yours and your guests&apos; — nothing more.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-5 sm:grid-cols-3">
            {[
              { title: 'Encrypted storage', desc: 'Your photos are stored securely and never sold to third parties.' },
              { title: 'You control access', desc: 'Only people with your room link can view or upload photos.' },
              { title: 'Download or delete', desc: 'Keep your gallery forever or wipe it completely. Your choice.' },
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
                    q: 'Do guests need to sign up or install anything?',
                    a: 'No. Guests open the QR code or link in their browser and upload photos directly from their camera roll. No apps, no accounts, no hassle.',
                  },
                  {
                    q: 'Can I use this for a dinner party or small gathering?',
                    a: 'Absolutely. SnapRooms works for any size gathering — from intimate dinners to full-blown ragers. One room, any crowd.',
                  },
                  {
                    q: 'Is there a photo limit?',
                    a: 'No. Guests can upload unlimited photos. There are no storage caps on free or Pro plans.',
                  },
                  {
                    q: 'How private is the gallery?',
                    a: 'Completely private. Only people with your unique room link can access it. The gallery is not indexed by search engines and never appears on public feeds.',
                  },
                  {
                    q: 'How long does the gallery stay open?',
                    a: 'Free galleries stay active for 7 days. Upgrade to Pro for permanent galleries that never expire.',
                  },
                  {
                    q: 'Is it really free?',
                    a: 'Yes. Create one room, invite unlimited guests, and collect unlimited photos at no cost. Pro plans add unlimited rooms and permanent storage.',
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
              Never lose a party photo again
            </h2>
            <p className="mt-3 text-muted-foreground">
              Create your party room in seconds and collect every moment from the night —
              before the memories fade.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" className="glow-blue" asChild>
                <a href="/">Create free party room</a>
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
