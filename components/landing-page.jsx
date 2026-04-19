'use client'

import { useState, useRef } from 'react'
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

// Simple smooth scroll helper
function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
  }
}

export function LandingPage({ 
  onCreateEvent, 
  eventName, 
  setEventName, 
  isCreating 
}) {
  const [email, setEmail] = useState('')
  const featuresRef = useRef(null)

  return (
    <div className="relative">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">SnapRooms</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => scrollToSection('how-it-works')}
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              How it works
            </button>
            <Button size="sm" variant="ghost" asChild>
              <a href="/dashboard/login">Sign in</a>
            </Button>
            <Button size="sm" onClick={() => scrollToSection('create')}>
              Create room
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-24">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-background to-background" />
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        
        <div className="container relative px-4">
          <div className="mx-auto max-w-3xl text-center">
            {/* Logo */}
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="mx-auto mb-6 h-12 w-12 rounded-lg object-cover"
            />

            {/* Badge */}
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              <span>No apps • No signup</span>
            </div>

            {/* Headline -->
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl sm:leading-tight lg:text-6xl">
              Every guest photo.
              <span className="block text-primary">One room.</span>
            </h1>

            {/* Subheadline */}
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
              Create a room, share a QR code, collect every moment instantly.
            </p>

            {/* CTA */}
            <div id="create" className="mt-8 flex flex-col items-center gap-3">
              <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Room name (e.g. Sarah's Wedding)"
                  className="h-12 flex-1 text-base"
                />
                <Button 
                  size="lg" 
                  className="h-12 gap-2 px-8 text-base whitespace-nowrap"
                  onClick={onCreateEvent}
                  disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3}
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
              
              {/* Micro-trust */}
              <p className="text-xs text-muted-foreground">
                No apps • No signup • Works instantly
              </p>
              
              {/* Secondary owner CTA */}
              <p className="text-xs text-muted-foreground">
                Already created a room?{' '}
                <a href="/dashboard/login" className="underline underline-offset-2 hover:text-foreground">
                  Sign in
                </a>
              </p>
              
              {/* Social proof */}
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                Used at weddings, parties & events worldwide
              </p>
            </div>

            {/* Trust signals */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span>Free forever</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span>Unlimited guests</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span>Instant gallery</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="border-y bg-muted/30 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How it works</h2>
            <p className="mt-3 text-muted-foreground">Three simple steps to collect every moment</p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-8 sm:grid-cols-3">
            {/* Step 1 */}
            <div className="relative flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Step 1</div>
                <h3 className="mt-1 text-lg font-semibold">Create your room</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Name your room and get a unique code and QR code instantly.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Share2 className="h-6 w-6" />
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Step 2</div>
                <h3 className="mt-1 text-lg font-semibold">Share with guests</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Send the link or display the QR code at your venue.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <ImagePlus className="h-6 w-6" />
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary">Step 3</div>
                <h3 className="mt-1 text-lg font-semibold">Collect photos</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Watch your gallery fill up as guests upload.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why SnapRooms - Pain Point */}
      <section className="py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: The Problem */}
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  After the event, the photos are everywhere
                </h2>
                <p className="mt-3 text-muted-foreground">
                  Your guests took hundreds of photos. Now they're scattered across messages, emails, and social apps. You'll never see most of them.
                </p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="text-base">💬</span>
                    <span className="text-sm">Some in WhatsApp, some in iMessage, some in Instagram DMs</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="text-base">😰</span>
                    <span className="text-sm">You have to ask, download, and organize them yourself</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span className="text-base">⏰</span>
                    <span className="text-sm">By the time you remember, guests have already deleted them</span>
                  </div>
                </div>
              </div>

              {/* Right: The Solution */}
              <div className="relative">
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent" />
                <div className="relative space-y-4 rounded-2xl border bg-background p-6 shadow-lg">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold">One link, all your photos</h3>
                  </div>
                  <p className="text-muted-foreground">
                    Share one link with guests. Every photo they upload goes into the same gallery. You don't chase anyone.
                  </p>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold">No app needed</h3>
                  </div>
                  <p className="text-muted-foreground">
                    Guests open a link and upload. Works on any phone, instantly.
                  </p>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <Users className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-semibold">Unlimited guests</h3>
                  </div>
                  <p className="text-muted-foreground">
                    Share with 5 people or 500. Everyone can upload, no accounts required.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="border-y bg-muted/30 py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Perfect for any occasion</h2>
            <p className="mt-3 text-muted-foreground">Trusted by hosts at events of all sizes</p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-3">
            {/* Weddings */}
            <div className="group relative overflow-hidden rounded-2xl border bg-background p-6 transition-all hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                <Heart className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Weddings</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Capture every candid moment from your special day. Guests love contributing to your wedding album.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Beautiful QR cards for tables</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>See photos as they happen</span>
                </li>
              </ul>
            </div>

            {/* Parties */}
            <div className="group relative overflow-hidden rounded-2xl border bg-background p-6 transition-all hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <PartyPopper className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Birthday Parties</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                From milestone birthdays to surprise parties. Collect all the fun moments in one place.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Instant sharing with friends</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>No social media required</span>
                </li>
              </ul>
            </div>

            {/* Corporate */}
            <div className="group relative overflow-hidden rounded-2xl border bg-background p-6 transition-all hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                <Building2 className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Corporate Events</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Conferences, team building, company celebrations. Professional photo collection made simple.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Branded QR codes</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Download full gallery</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* QR Sharing Section */}
      <section className="py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              {/* Left: Content */}
              <div className="order-2 lg:order-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                  <QrCode className="h-3 w-3" />
                  <span>Premium feature</span>
                </div>
                <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
                  QR codes that work at your venue
                </h2>
                <p className="mt-4 text-muted-foreground">
                  Place a card on each table. Guests scan and upload in seconds. 
                  You'll have every photo by the end of the night.
                </p>
                
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Printer className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-medium">Table cards</h4>
                      <p className="text-sm text-muted-foreground">4×6 inch cards for guest tables</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Download className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-medium">Entrance posters</h4>
                      <p className="text-sm text-muted-foreground">A4 and A5 sizes for displays</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Share2 className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-medium">Digital share</h4>
                      <p className="text-sm text-muted-foreground">Link works in invites, texts, email</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-medium">Clean design</h4>
                      <p className="text-sm text-muted-foreground">Matches your event aesthetic</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Visual */}
              <div className="order-1 lg:order-2">
                <div className="relative mx-auto max-w-sm">
                  {/* Decorative elements */}
                  <div className="absolute -top-4 -right-4 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                  <div className="absolute -bottom-4 -left-4 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
                  
                  {/* QR Card Mockup */}
                  <div className="relative rounded-2xl border bg-white p-6 shadow-xl">
                    <div className="text-center">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Sarah & Mike's Wedding</p>
                      <div className="mx-auto my-4 flex h-40 w-40 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                        <QrCode className="h-20 w-20 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium">Scan to upload your photos</p>
                      <p className="mt-1 text-xs text-muted-foreground">snaprooms.app/room/sarah-mike</p>
                    </div>
                  </div>
                  
                  {/* Floating badges */}
                  <div className="absolute -right-2 top-1/4 rounded-full border bg-white px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      Instant upload
                    </span>
                  </div>
                  <div className="absolute -left-2 bottom-1/4 rounded-full border bg-white px-3 py-1.5 text-xs font-medium shadow-lg">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3 text-primary" />
                      47 photos
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof / How it feels */}
      <section className="border-y bg-muted/30 py-12">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-lg text-muted-foreground">
              "I didn't have to chase anyone for photos. 
              <span className="text-foreground">They just appeared.</span>"
            </p>
            <p className="mt-3 text-sm text-muted-foreground">— Sarah, used at her wedding</p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 sm:py-24">
        <div className="container px-4">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Don't miss a single photo
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Your guests are already taking pictures. Give them a simple way to share.
            </p>
            
            <div className="mt-8 flex w-full max-w-md mx-auto flex-col gap-3 sm:flex-row">
              <Input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="Room name (e.g. Sarah's Wedding)"
                className="h-12 flex-1 text-base"
              />
              <Button 
                size="lg" 
                className="h-12 gap-2 px-8 text-base whitespace-nowrap"
                onClick={onCreateEvent}
                disabled={isCreating || !eventName?.trim() || eventName.trim().length < 3}
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

            <p className="mt-4 text-xs text-muted-foreground">
              Takes 10 seconds. No credit card required.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-8">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Camera className="h-3 w-3" />
              </div>
              <span className="text-sm font-semibold">SnapRooms</span>
            </div>
            <p className="text-xs text-muted-foreground">
              The easiest way to collect guest photos.
            </p>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground">
                Privacy Policy
              </a>
              <a href="/dashboard/login" className="text-xs text-muted-foreground hover:text-foreground">
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
