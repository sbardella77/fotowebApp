'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { LandingPage } from '@/components/landing-page'
import { Button } from '@/components/ui/button'

export default function HomePage() {
  const router = useRouter()
  const [eventName, setEventName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return Boolean(params.get('event'))
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const eventSlug = params.get('event')
    if (eventSlug) {
      router.replace(`/event/${eventSlug}`)
    }
  }, [router])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    if (!trimmedName || trimmedName.length < 3) return

    setIsCreating(true)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      const payload = await response.json()
      if (response.ok && payload.event?.slug) {
        router.push(`/event/${payload.event.slug}`)
      }
    } finally {
      setIsCreating(false)
    }
  }

  if (isRedirecting) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <img
                src="/snaprooms-logo.svg"
                alt="SnapRooms"
                className="h-8 w-8 rounded-md object-cover"
              />
              <span className="font-semibold tracking-tight">SnapRooms</span>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href="/dashboard">Manage rooms</a>
            </Button>
          </div>
        </header>
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-4">
          <img
            src="/snaprooms-logo.svg"
            alt="SnapRooms"
            className="h-12 w-12 rounded-lg object-cover"
          />
          <p className="text-lg font-medium text-foreground">Opening your room...</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="h-8 w-8 rounded-md object-cover"
            />
            <span className="font-semibold tracking-tight">SnapRooms</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href="/dashboard">Manage rooms</a>
          </Button>
        </div>
      </header>
      <LandingPage
        onCreateEvent={createEvent}
        eventName={eventName}
        setEventName={setEventName}
        isCreating={isCreating}
      />
    </main>
  )
}
