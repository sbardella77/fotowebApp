'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW, EVENT_HERO_CTA_CLICKED, EVENT_CREATE_ROOM_CLICKED } from '@/lib/analytics/events'
import {
  Camera,
  Heart,
  Church,
  Wine,
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
  Shield,
  Lock,
  Infinity,
  Archive,
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

export function WeddingLandingPage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useScrollReveal()

  useEffect(() => {
    trackPageView('landing', { variant: 'wedding' })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'wedding' })
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_HERO_CTA_CLICKED, { page_type: 'landing', variant: 'wedding', position: 'hero' })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, { page_type: 'landing', variant: 'wedding' })

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
      {/* Noise texture overlay */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>
          <div className="flex items-center gap-4">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              How it works
            </button>
            <button
              onClick={() => scrollToSection('faq')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              FAQ
            </button>
            <Button size="sm" variant="ghost" asChild className="font-body">
              <a href="/dashboard/login">Sign in</a>
            </Button>
            <Button size="sm" onClick={() => scrollToSection('create')} className="font-body">
              Create room
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
        />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
              <Heart className="h-3 w-3 text-rose-400" />
              <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                Wedding Photo Sharing
              </span>
            </div>

            {/* H1 */}
            <h1 className="animate-fade-up delay-100 mt-6 font-display text-4xl font-extrabold tracking-[-0.03em] text-white sm:text-5xl lg:text-6xl">
              Wedding photo sharing{' '}
              <span className="text-gradient">made simple</span>
            </h1>

            {/* Subheadline */}
            <p className="animate-fade-up delay-200 mt-6 text-lg font-light leading-relaxed text-muted-foreground sm:text-xl">
              Collect every guest photo in one beautiful gallery. Share a QR code, let guests upload instantly, and keep every moment together — no app, no signup.
            </p>

            {/* Create room form */}
            <div id="create" className="animate-fade-up delay-300 mt-10 flex w-full max-w-lg mx-auto flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Wedding room name (e.g. Sarah & Mike)"
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="Your email"
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap glow-blue"
                onClick={createEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
              >
                {isCreating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    Create your wedding room — it's free
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            {/* Trust signals */}
            <div className="animate-fade-up delay-500 mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Free forever</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Unlimited guests</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Instant gallery</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: The Problem */}
              <div className="reveal">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  The problem
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
                  Your wedding photos are scattered across dozens of phones
                </h2>
                <p className="mt-3 font-light text-muted-foreground">
                  Your guests capture incredible candid moments during your special day. But those photos end up trapped in group chats, social feeds, and camera rolls — and most of them you'll never see.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    { emoji: '💬', text: 'Photos scattered across WhatsApp, iMessage, and Instagram DMs' },
                    { emoji: '😰', text: 'You spend weeks chasing guests to send their pictures' },
                    { emoji: '⏰', text: 'By the time you ask, many memories are already lost or deleted' },
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
                      icon: ImagePlus,
                      title: 'One gallery, every moment',
                      desc: 'Every photo your guests take flows into the same beautiful gallery. You don\'t chase anyone.',
                    },
                    {
                      icon: Smartphone,
                      title: 'No app needed',
                      desc: 'Guests open a link or scan a QR code and upload instantly. Works on any phone.',
                    },
                    {
                      icon: Lock,
                      title: 'Private by default',
                      desc: 'Your wedding gallery is only accessible to people with your link. No public feeds.',
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

      {/* How It Works */}
      <section id="how-it-works" className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              How it works
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Three simple steps for your big day
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              Set up in seconds, collect memories all night
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                step: '01',
                icon: Sparkles,
                title: 'Create your wedding room',
                desc: 'Name your room and get a unique link and QR code instantly.',
              },
              {
                step: '02',
                icon: Share2,
                title: 'Share with guests',
                desc: 'Display the QR code on table cards or share the link in invites.',
              },
              {
                step: '03',
                icon: ImagePlus,
                title: 'Collect every photo',
                desc: 'Watch your gallery fill up with candid moments from every guest.',
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
                    Step {item.step}
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

      {/* Wedding Use Cases */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              Use cases
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Perfect for every wedding moment
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              From the ceremony to the last dance
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                icon: Church,
                color: 'text-rose-400',
                bg: 'bg-rose-500/10',
                title: 'The Ceremony',
                desc: 'Capture every angle of your vows from the guests who see it best.',
                bullets: ['Guest perspectives from every pew', 'Candid reactions you never see'],
              },
              {
                icon: Wine,
                color: 'text-amber-400',
                bg: 'bg-amber-500/10',
                title: 'The Reception',
                desc: 'From speeches to the dance floor, collect every unforgettable moment.',
                bullets: ['Table candids and group shots', 'Dance floor memories all night long'],
              },
              {
                icon: Heart,
                color: 'text-pink-400',
                bg: 'bg-pink-500/10',
                title: 'Engagement Party',
                desc: 'Start collecting memories before the wedding day even arrives.',
                bullets: ['Pre-wedding celebration photos', 'Share the excitement with family'],
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

      {/* QR Code Section */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="reveal order-2 lg:order-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
                  <QrCode className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                    QR Code Sharing
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
                  Share a QR code with your wedding guests
                </h2>
                <p className="mt-2 text-base font-light text-muted-foreground">
                  Print it. Place it. Guests scan and upload instantly.
                </p>
                <p className="mt-4 font-light text-muted-foreground">
                  Place a beautiful QR card on each reception table. Guests scan with their phone camera, open the link, and upload photos in seconds. You'll have every candid moment by the end of the night.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {[
                    { icon: Printer, title: 'Table cards', desc: 'Elegant cards for every guest table' },
                    { icon: Download, title: 'Welcome signs', desc: 'A4 and A5 sizes for entrance displays' },
                    { icon: Share2, title: 'Digital share', desc: 'Link works in invites, texts, and emails' },
                    { icon: Sparkles, title: 'Clean design', desc: 'Matches your wedding aesthetic' },
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
                  <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-rose-500/10 blur-2xl" aria-hidden="true" />

                  <div className="relative rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                    <div className="text-center">
                      <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                        Sarah & Mike's Wedding
                      </p>
                      <div className="mx-auto my-4 flex h-40 w-40 items-center justify-center rounded-xl border-2 border-dashed border-white/[0.07] bg-[#111827]">
                        <QrCode className="h-20 w-20 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-white">Scan to upload your photos</p>
                      <p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">snaprooms.app/room/sarah-mike</p>
                    </div>
                  </div>

                  <div className="absolute -right-2 top-1/4 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      <span className="font-mono text-[0.65rem]">Instant upload</span>
                    </span>
                  </div>
                  <div className="absolute -left-2 bottom-1/4 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-primary" />
                      <span className="font-mono text-[0.65rem]">127 photos</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              Benefits
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Why couples love SnapRooms
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              Everything you need to collect wedding memories without the hassle
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Users,
                title: 'Unlimited guests',
                desc: 'Invite your entire wedding party. No caps, no extra fees.',
              },
              {
                icon: ImagePlus,
                title: 'Instant gallery',
                desc: 'Photos appear in real time as guests upload them.',
              },
              {
                icon: Smartphone,
                title: 'No app required',
                desc: 'Guests use their phone browser. Nothing to install.',
              },
              {
                icon: Archive,
                title: 'Full resolution',
                desc: 'Every photo is kept at original quality. No compression.',
              },
              {
                icon: EyeOff,
                title: 'Private by default',
                desc: 'Only people with your link can see or upload photos.',
              },
              {
                icon: Download,
                title: 'Download everything',
                desc: 'Export your entire wedding gallery with one click.',
              },
            ].map((item, i) => (
              <div
                key={item.title}
                className="reveal rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 transition-all duration-200 hover:-translate-y-px hover:border-white/[0.12]"
                style={{ transitionDelay: `${i * 40}ms` }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-base font-bold tracking-tight text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm font-light text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust / Privacy */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div className="reveal">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  Privacy
                </span>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
                  Your wedding memories stay private
                </h2>
                <p className="mt-3 font-light text-muted-foreground">
                  Your wedding photos belong to you. We don't sell your data, we don't show ads, and we never publicly index your gallery.
                </p>
                <div className="mt-6 space-y-4">
                  {[
                    {
                      icon: Shield,
                      title: 'GDPR compliant',
                      desc: 'Your data is protected under European privacy standards.',
                    },
                    {
                      icon: Lock,
                      title: 'Encrypted storage',
                      desc: 'Photos are stored securely and only accessible via your private link.',
                    },
                    {
                      icon: Infinity,
                      title: 'You own your data',
                      desc: 'Delete your room and all photos at any time from your dashboard.',
                    },
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

              <div className="reveal relative" style={{ transitionDelay: '100ms' }}>
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 shadow-card text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Shield className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-lg font-light text-muted-foreground">
                    "I loved that our wedding gallery was completely private. No social media, no public feeds — just our moments, shared with the people we love."
                  </p>
                  <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
                    — Emily & James, married June 2025
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              FAQ
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Common questions about wedding photo sharing
            </h2>
          </div>

          <div className="reveal mx-auto mt-12 max-w-3xl">
            <Accordion type="single" collapsible className="w-full">
              {[
                {
                  q: 'Do wedding guests need to download an app?',
                  a: 'No. Guests simply open the link or scan your QR code in their phone browser and upload photos instantly. It works on iPhone, Android, and any modern smartphone.',
                },
                {
                  q: 'Can I print QR codes for my wedding tables?',
                  a: 'Yes. Every SnapRooms room comes with a printable QR card. You can download it as a PDF and print it at home or through a professional printer. Table cards, welcome signs, and entrance posters all work beautifully.',
                },
                {
                  q: 'Is there a limit on how many photos guests can upload?',
                  a: 'No. There is no limit on the number of photos or guests. Your wedding gallery can grow as large as it needs to be.',
                },
                {
                  q: 'Are the photos kept at full resolution?',
                  a: 'Yes. We keep every photo at its original resolution so you can print, frame, and preserve your memories in the highest quality possible. Original-resolution downloads are included with premium plans or a one-time €1.99 room unlock on Free.',
                },
                {
                  q: 'Can I download all photos after the wedding?',
                  a: 'Yes. As the room owner, you can download your entire wedding gallery at any time from your dashboard.',
                },
                {
                  q: 'Is SnapRooms free for weddings?',
                  a: 'Yes. SnapRooms is completely free for weddings and all other events. There are no hidden fees, no subscriptions, and no credit card required.',
                },
              ].map((item, i) => (
                <AccordionItem key={i} value={`item-${i}`} className="border-white/[0.07]">
                  <AccordionTrigger className="text-left font-display text-base font-semibold tracking-tight text-white hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm font-light text-muted-foreground">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
              Don't lose a single wedding memory
            </h2>
            <p className="mt-4 text-lg font-light text-muted-foreground">
              Your guests are already taking pictures. Give them a beautiful way to share.
            </p>

            <div className="mt-8 flex w-full max-w-md mx-auto flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Wedding room name (e.g. Sarah & Mike)"
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="Your email"
                  className="h-12 flex-1 rounded-lg border-white/[0.07] bg-[#141C2E] text-base font-body text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 rounded-lg px-8 text-base font-body font-medium whitespace-nowrap glow-blue"
                onClick={createEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
              >
                {isCreating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    Create your free wedding room
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>

            <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
              Takes 10 seconds. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.07] bg-[#0D1220] py-8">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <a href="/" className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Camera className="h-3 w-3" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
            </a>
            <p className="text-xs font-light text-muted-foreground">
              The easiest way to collect guest photos.
            </p>
            <div className="flex items-center gap-4">
              <a href="/pricing" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                Pricing
              </a>
              <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                Privacy Policy
              </a>
              <a href="/terms" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                Terms
              </a>
              <a href="/dashboard/login" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                Organizer sign in
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
