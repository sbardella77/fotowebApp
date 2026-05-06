'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { LandingPage } from '@/components/landing-page'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW, EVENT_CREATE_ROOM_CLICKED } from '@/lib/analytics/events'

export function HomePageClient({ locale = 'en' }) {
  const router = useRouter()
  const t = useTranslations('landing')
  const tCommon = useTranslations('common')
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [isRedirecting, setIsRedirecting] = useState(() => {
    if (typeof window === 'undefined') return false
    const params = new URLSearchParams(window.location.search)
    return Boolean(params.get('event'))
  })

  useEffect(() => {
    if (isRedirecting) return
    trackPageView('landing', { variant: 'generic', locale })
    trackEvent(EVENT_LANDING_VIEW, { variant: 'generic', locale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRedirecting, locale])

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
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) return
    if (!trimmedEmail || !trimmedEmail.includes('@')) return

    trackEvent(EVENT_CREATE_ROOM_CLICKED, {
      page_type: 'landing',
      variant: 'generic',
      locale,
    })

    setIsCreating(true)
    setCreateError(null)
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
        payload = { error: `${t.serverError} (${response.status}). ${t.pleaseTryAgain}` }
      }
      if (response.ok && payload.event?.slug) {
        router.push(`/event/${payload.event.slug}?new=1`)
      } else if (!response.ok) {
        setCreateError(payload)
      }
    } catch (e) {
      console.error('[createEvent] Error:', e)
      setCreateError({ error: e.message || t.genericError })
    } finally {
      setIsCreating(false)
    }
  }

  if (isRedirecting) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="container flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <img src="/snaprooms-logo.svg" alt="SnapRooms" fetchPriority="high" className="h-9 w-9 rounded-xl object-cover shadow-subtle" />
              <span className="font-display text-[15px] font-bold tracking-tight text-primary">SnapRooms</span>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href="/dashboard/login">{tCommon.signIn}</a>
            </Button>
          </div>
        </header>
        <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4">
          <img src="/snaprooms-logo.svg" alt="SnapRooms" fetchPriority="high" className="h-14 w-14 rounded-xl object-cover shadow-card" />
          <p className="text-lg font-medium text-foreground">{t.openingRoom}</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <img src="/snaprooms-logo.svg" alt="SnapRooms" className="h-9 w-9 rounded-xl object-cover shadow-subtle" />
            <span className="font-display text-[15px] font-bold tracking-tight text-primary">SnapRooms</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href="/dashboard/login">{tCommon.signIn}</a>
            </Button>
          </div>
        </div>
      </header>
      <LandingPage
        locale={locale}
        onCreateEvent={createEvent}
        eventName={eventName}
        setEventName={setEventName}
        ownerEmail={ownerEmail}
        setOwnerEmail={setOwnerEmail}
        isCreating={isCreating}
        createError={createError}
        onClearCreateError={() => setCreateError(null)}
      />
    </main>
  )
}
