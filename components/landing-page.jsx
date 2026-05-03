'use client'

import { useState, useRef, useEffect } from 'react'
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
  Printer
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InstallCta } from '@/components/install-cta'
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
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )

    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
}

export function LandingPage({
  onCreateEvent,
  eventName,
  setEventName,
  ownerEmail,
  setOwnerEmail,
  isCreating,
  createError = null,
  onClearCreateError,
}) {
  const featuresRef = useRef(null)
  useScrollReveal()

  return (
    <div className="dark relative min-h-screen bg-background font-body text-foreground">
      {/* Noise texture overlay */}
      <div className="noise-overlay" aria-hidden="true" />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              How it works
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
          aria-hidden="true"
        />
        {/* Blur orbs */}
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" aria-hidden="true" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-[100px]" aria-hidden="true" />

        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            {/* Logo */}
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="mx-auto mb-6 h-12 w-12 rounded-lg object-cover animate-fade-up"
            />

            {/* Badge */}
            <div className="animate-fade-up delay-100 mb-6 inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                No apps • No signup
              </span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-up delay-200 font-display text-[2rem] font-extrabold tracking-[-0.03em] text-white sm:text-5xl sm:leading-tight lg:text-6xl">
              Every guest photo.
              <span className="block text-gradient">One room.</span>
            </h1>

            {/* Subheadline */}
            <p className="animate-fade-up delay-300 mx-auto mt-6 max-w-xl text-lg font-light text-muted-foreground">
              Create a room, share a QR code, collect every moment instantly.
            </p>

            {/* CTA */}
            <div id="create" className="animate-fade-up delay-400 mt-10 flex flex-col items-center gap-4">
              <div className="flex w-full max-w-md flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder="Room name (e.g. Sarah's Wedding)"
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
                      Create your room — it's free
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>

              {createError?.limit === 'room_count' && (
                <div className="mx-auto max-w-md rounded-xl border border-white/[0.07] bg-[#141C2E] p-4 text-left">
                  <p className="text-sm font-medium text-white">
                    You&apos;ve reached the Free plan limit of 1 active room.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Upgrade to Professional to create and manage multiple rooms for all your events.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="glow-blue" asChild>
                      <a href="/pricing">View pricing</a>
                    </Button>
                    <Button size="sm" variant="outline" className="border-white/[0.07] bg-[#0D1220]" asChild>
                      <a href="/dashboard/login">Start Professional</a>
                    </Button>
                  </div>
                </div>
              )}

              {createError && createError.limit !== 'room_count' && (
                <div className="mx-auto max-w-md rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-left">
                  <p className="text-sm font-medium text-red-400">
                    {createError.error || 'Unable to create room. Please try again.'}
                  </p>
                </div>
              )}

              {/* Microcopy */}
              <p className="text-sm font-light text-muted-foreground">
                Create a room in seconds. No signup required.
              </p>

              {/* Trust line */}
              <p className="text-xs font-light text-muted-foreground">
                No apps. No logins. Works instantly on any phone.
              </p>
              <p className="text-xs font-light text-muted-foreground/70">
                We'll use your email to help you manage and recover your room.
              </p>

              {/* Secondary owner CTA */}
              <p className="text-xs text-muted-foreground">
                Already created a room?{' '}
                <a href="/dashboard/login" className="underline underline-offset-2 hover:text-foreground">
                  Sign in
                </a>
              </p>

              {/* Social proof */}
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted-foreground/60">
                Used at weddings, parties & events worldwide
              </p>

              {/* Micro-urgency / quiet reassurance */}
              <p className="text-xs font-light text-muted-foreground/70">
                Used at weddings, parties and events every day.
              </p>
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

      {/* How It Works */}
      <section id="how-it-works" className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              How it works
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Three simple steps
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              Collect every moment without chasing anyone
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                step: '01',
                icon: Sparkles,
                title: 'Create your room',
                desc: 'Name your room and get a unique code and QR code instantly.',
              },
              {
                step: '02',
                icon: Share2,
                title: 'Share with guests',
                desc: 'Send the link or display the QR code at your venue.',
              },
              {
                step: '03',
                icon: ImagePlus,
                title: 'Collect photos',
                desc: 'Watch your gallery fill up as guests upload.',
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

      {/* Why SnapRooms - Pain Point */}
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
                  After the event, the photos are everywhere
                </h2>
                <p className="mt-3 font-light text-muted-foreground">
                  Your guests took hundreds of photos. Now they're scattered across messages, emails, and social apps. You'll never see most of them.
                </p>
                <div className="mt-6 space-y-3">
                  {[
                    { emoji: '💬', text: 'Some in WhatsApp, some in iMessage, some in Instagram DMs' },
                    { emoji: '😰', text: 'You have to ask, download, and organize them yourself' },
                    { emoji: '⏰', text: 'By the time you remember, guests have already deleted them' },
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
                      icon: CheckCircle2,
                      title: 'One link, all your photos',
                      desc: 'Share one link with guests. Every photo they upload goes into the same gallery. You don\'t chase anyone.',
                    },
                    {
                      icon: Smartphone,
                      title: 'No app needed',
                      desc: 'Guests open a link and upload. Works on any phone, instantly.',
                    },
                    {
                      icon: Users,
                      title: 'Unlimited guests',
                      desc: 'Share with 5 people or 500. Everyone can upload, no accounts required.',
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

      {/* Use Cases */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-3xl text-center">
            <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
              Use cases
            </span>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
              Perfect for any occasion
            </h2>
            <p className="mt-3 font-light text-muted-foreground">
              Trusted by hosts at events of all sizes
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                icon: Heart,
                color: 'text-rose-400',
                bg: 'bg-rose-500/10',
                title: 'Weddings',
                desc: 'Capture every candid moment from your special day. Guests love contributing to your wedding album.',
                bullets: ['Beautiful QR cards for tables', 'See photos as they happen'],
              },
              {
                icon: PartyPopper,
                color: 'text-amber-400',
                bg: 'bg-amber-500/10',
                title: 'Birthday Parties',
                desc: 'From milestone birthdays to surprise parties. Collect all the fun moments in one place.',
                bullets: ['Instant sharing with friends', 'No social media required'],
              },
              {
                icon: Building2,
                color: 'text-blue-400',
                bg: 'bg-blue-500/10',
                title: 'Corporate Events',
                desc: 'Conferences, team building, company celebrations. Professional photo collection made simple.',
                bullets: ['Branded QR codes', 'Download full gallery'],
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

      {/* QR Sharing Section */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="reveal order-2 lg:order-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#141C2E] px-3 py-1">
                  <QrCode className="h-3 w-3 text-primary" />
                  <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                    Premium feature
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
                  QR codes that work at your venue
                </h2>
                <p className="mt-2 text-base font-light text-muted-foreground">
                  Print it. Place it. Guests scan and upload instantly.
                </p>
                <p className="mt-4 font-light text-muted-foreground">
                  Place a card on each table. Guests scan and upload in seconds.
                  You'll have every photo by the end of the night.
                </p>

                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {[
                    { icon: Printer, title: 'Table cards', desc: '4×6 inch cards for guest tables' },
                    { icon: Download, title: 'Entrance posters', desc: 'A4 and A5 sizes for displays' },
                    { icon: Share2, title: 'Digital share', desc: 'Link works in invites, texts, email' },
                    { icon: Sparkles, title: 'Clean design', desc: 'Matches your event aesthetic' },
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
                  <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-cyan-500/10 blur-2xl" aria-hidden="true" />

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
                      <span className="font-mono text-[0.65rem]">47 photos</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="border-y border-white/[0.07] bg-[#0D1220] py-12">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-lg font-light text-muted-foreground">
              "I didn't have to chase anyone for photos.
              <span className="text-white"> They just appeared.</span>"
            </p>
            <p className="mt-3 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted-foreground">
              — Sarah, used at her wedding
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 sm:py-24">
        <div className="container px-4">
          <div className="reveal mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-extrabold tracking-[-0.03em] text-white sm:text-4xl">
              Don't miss a single photo
            </h2>
            <p className="mt-4 text-lg font-light text-muted-foreground">
              Your guests are already taking pictures. Give them a simple way to share.
            </p>

            <div className="mt-8 flex w-full max-w-md mx-auto flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Room name (e.g. Sarah's Wedding)"
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
                onClick={onCreateEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3 || !ownerEmail?.trim() || !ownerEmail.includes('@')}
              >
                {isCreating ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <>
                    Create your free room
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

      <div className="container mx-auto max-w-3xl px-4 pb-6">
        <InstallCta mode="landing" />
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.07] bg-[#0D1220] py-8">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Camera className="h-3 w-3" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
            </div>
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

export default LandingPage
