'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { LandingPage } from '@/components/landing-page'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { SnapRoomsLogo, SnapRoomsIcon } from '@/components/marketing/logo'
import { useCreateEventForm } from '@/lib/hooks/use-create-event-form'

export function HomePageClient({ locale = 'en' }) {
  const router = useRouter()
  const t = useTranslations('landing')
  const tCommon = useTranslations('common')
  const [isRedirecting, setIsRedirecting] = useState(false)

  const {
    eventName,
    setEventName,
    ownerEmail,
    setOwnerEmail,
    isCreating,
    createError,
    setCreateError,
    createEvent,
  } = useCreateEventForm({ variant: 'generic', locale })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const eventSlug = params.get('event')
    if (eventSlug) {
      setIsRedirecting(true)
      router.replace(`/event/${eventSlug}`)
    }
  }, [router])

  if (isRedirecting) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card/80 backdrop-blur-xl">
          <div className="container flex h-16 items-center justify-between px-4">
            <SnapRoomsLogo size="md" />
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <a href="/dashboard/login">{tCommon.signIn}</a>
            </Button>
          </div>
        </header>
        <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4">
          <SnapRoomsIcon className="h-14 w-14" />
          <p className="text-lg font-medium text-foreground">{t.openingRoom}</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
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
