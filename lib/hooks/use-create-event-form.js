'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent, trackPageView } from '@/lib/analytics/track-client'
import { EVENT_LANDING_VIEW, EVENT_HERO_CTA_CLICKED, EVENT_CREATE_ROOM_CLICKED } from '@/lib/analytics/events'

/**
 * Shared state + submit logic for the "Create event" hero/final-CTA form
 * repeated across every landing-page variant (generic, wedding,
 * photographers, planners, private party, corporate, birthday).
 *
 * Fires the landing pageview on mount, validates name/email on submit with
 * a visible inline error (never a silent no-op — see the uniform-CTA fix),
 * and redirects to the new event on success.
 *
 * @param {{ variant: string, locale?: string }} options
 *   `variant` is the analytics dimension (e.g. 'wedding', 'photographers').
 */
export function useCreateEventForm({ variant, locale }) {
  const router = useRouter()
  const t = useTranslations('landing')
  const [eventName, setEventName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  useEffect(() => {
    trackPageView('landing', { variant, locale })
    trackEvent(EVENT_LANDING_VIEW, { variant, locale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createEvent = async () => {
    const trimmedName = eventName?.trim()
    const trimmedEmail = ownerEmail?.trim()
    if (!trimmedName || trimmedName.length < 3) {
      setCreateError({ error: t.eventNameTooShort })
      return
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setCreateError({ error: t.enterValidEmail })
      return
    }

    trackEvent(EVENT_HERO_CTA_CLICKED, { page_type: 'landing', variant, position: 'hero' })
    trackEvent(EVENT_CREATE_ROOM_CLICKED, { page_type: 'landing', variant, locale })

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

  return {
    eventName,
    setEventName,
    ownerEmail,
    setOwnerEmail,
    isCreating,
    createError,
    setCreateError,
    createEvent,
  }
}
