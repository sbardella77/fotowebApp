'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Eye, EyeOff, ImagePlus, Loader2, Lock, LogOut, Pencil, Plus, QrCode, Share2, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
import { trackEvent, identifyUser } from '@/lib/analytics/track-client'
import {
  EVENT_DASHBOARD_VIEWED,
  EVENT_CREATE_ROOM_CLICKED,
  EVENT_ROOM_SELECTED_IN_DASHBOARD,
  EVENT_ROOM_SHARED_FROM_DASHBOARD,
  EVENT_ROOM_QR_OPENED_FROM_DASHBOARD,
  EVENT_UPGRADE_CLICKED,
  EVENT_CHECKOUT_CANCELLED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED,
} from '@/lib/analytics/events'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const DashboardPhotoCard = ({ photo, onApprove, onReject, onDelete, onOpenLightbox, busyId }) => {
  const isBusy = busyId === photo.id

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
      <button className="block w-full text-left" onClick={onOpenLightbox} type="button">
        <img alt={photo.originalName} className="aspect-square w-full object-cover" src={photo.url} />
      </button>
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{photo.originalName}</p>
            <p className="truncate text-xs font-light text-muted-foreground">{photo.uploaderName || 'Guest upload'}</p>
          </div>
          <Badge
            variant={photo.status === 'VISIBLE' ? 'default' : 'secondary'}
            className="rounded-full capitalize font-mono text-[0.6rem]"
          >
            {photo.status.toLowerCase()}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button
            disabled={isBusy || photo.status === 'VISIBLE'}
            size="sm"
            onClick={onApprove}
            className="h-8"
          >
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            disabled={isBusy || photo.status === 'HIDDEN'}
            size="sm"
            variant="outline"
            onClick={onReject}
            className="h-8 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827]"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </Button>
          <Button
            disabled={isBusy}
            size="sm"
            variant="destructive"
            onClick={onDelete}
            className="h-8"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()

  const [authState, setAuthState] = useState({ loading: true, authenticated: false, email: '' })
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [events, setEvents] = useState([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [busy, setBusy] = useState({ auth: false, detail: false, photoId: '' })
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [isEditingName, setIsEditingName] = useState(false)
  const [newEventName, setNewEventName] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryEmail, setRecoveryEmail] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)
  const [redirectParam, setRedirectParam] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrEvent, setQrEvent] = useState(null)
  const [editingSlug, setEditingSlug] = useState('')
  const [editName, setEditName] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [plan, setPlan] = useState('free')
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState(null)
  const dashboardViewTracked = useRef(false)

  const photos = useMemo(() => selectedEvent?.photos || [], [selectedEvent])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const redirect = params.get('redirect') || ''
      if (redirect && redirect.startsWith('/')) {
        setRedirectParam(redirect)
      }
    }
  }, [])

  useEffect(() => {
    if (!authState.loading && !dashboardViewTracked.current) {
      dashboardViewTracked.current = true
      trackEvent(EVENT_DASHBOARD_VIEWED, {
        authenticated: authState.authenticated,
        room_count: events.length,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.loading])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const keys = Object.keys(window.localStorage).filter((k) => k.startsWith('snaprooms:owner:'))
    if (keys.length > 0) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(keys[0]))
        if (parsed.email) setEmail(parsed.email)
        if (parsed.token) setToken(parsed.token)
      } catch {
        // ignore parse errors
      }
    }
  }, [])

  const loadSession = async () => {
    setAuthState((c) => ({ ...c, loading: true }))
    try {
      const response = await fetch('/api/owner/session', { cache: 'no-store' })
      const payload = await response.json()
      setAuthState({
        loading: false,
        authenticated: payload.authenticated,
        email: payload.email || '',
      })
      if (payload.authenticated && payload.email) {
        setEmail(payload.email)
      }
    } catch (error) {
      setAuthState({ loading: false, authenticated: false, email: '' })
      setMessage(error.message || 'Unable to load session')
    }
  }

  const login = async () => {
    setBusy((c) => ({ ...c, auth: true }))
    try {
      const response = await fetch('/api/owner/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), token: token.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Authentication failed')
      }
      setAuthState({ loading: false, authenticated: true, email: payload.email })
      setMessage('Signed in.')
      if (redirectParam && redirectParam.startsWith('/')) {
        router.push(redirectParam)
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, auth: false }))
    }
  }

  const logout = async () => {
    await fetch('/api/owner/logout', { method: 'POST' })
    setSelectedEvent(null)
    setSelectedSlug('')
    setEvents([])
    setAuthState({ loading: false, authenticated: false, email: '' })
    setMessage('Signed out.')
  }

  const loadPlan = async () => {
    try {
      const response = await fetch('/api/owner/plan', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json()
      setPlan(payload.plan || 'free')
    } catch {
      // ignore plan load errors
    }
  }

  const startCheckout = async (intent, eventId = null, entryPoint = 'dashboard') => {
    if (checkoutBusy) return
    setCheckoutBusy(true)
    try {
      trackEvent(EVENT_UPGRADE_CLICKED, {
        entryPoint,
        pageType: 'dashboard',
        userRole: 'owner',
        plan: plan || 'free',
        roomCount: events.length,
        billing_intent: intent,
        event_id: eventId,
      })
      const response = await fetch('/api/stripe/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, eventId, entryPoint }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Unable to start checkout')
      }
      window.location.href = payload.url
    } catch (error) {
      setMessage(error.message || 'Checkout failed. Please try again.')
      setCheckoutBusy(false)
    }
  }

  const loadEvents = async () => {
    try {
      const response = await fetch('/api/owner/events', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load rooms')
      setEvents(payload.events || [])
      if (!selectedSlug && payload.events?.[0]?.slug) {
        setSelectedSlug(payload.events[0].slug)
      }
    } catch (error) {
      if (error.message.includes('authentication')) {
        await loadSession()
      }
      setMessage(error.message)
    }
  }

  const loadEventDetail = async (slug) => {
    if (!slug) return
    setBusy((c) => ({ ...c, detail: true }))
    try {
      const response = await fetch(`/api/owner/events/${slug}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load room detail')
      setSelectedEvent(payload.event)
      setSelectedSlug(payload.event.slug)
      setMessage(`Viewing ${payload.event.name}.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, detail: false }))
    }
  }

  const moderatePhoto = async (photoId, action) => {
    setBusy((c) => ({ ...c, photoId }))
    try {
      const response = await fetch(`/api/owner/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to update photo')
      setMessage(action === 'approve' ? 'Photo approved.' : 'Photo hidden from the public gallery.')
      await loadEventDetail(selectedSlug)
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, photoId: '' }))
    }
  }

  const deletePhoto = async (photoId) => {
    setBusy((c) => ({ ...c, photoId }))
    try {
      const response = await fetch(`/api/owner/photos/${photoId}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to delete photo')
      setMessage('Photo deleted.')
      await loadEventDetail(selectedSlug)
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, photoId: '' }))
    }
  }

  const renameEvent = async () => {
    const trimmed = newEventName.trim()
    if (!trimmed || trimmed.length < 3 || trimmed === selectedEvent.name) {
      setIsEditingName(false)
      return
    }
    setBusy((c) => ({ ...c, detail: true }))
    try {
      const response = await fetch(`/api/owner/events/${selectedSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to rename room')
      setSelectedEvent(payload.event)
      setMessage('Room renamed.')
      await loadEvents()
      setIsEditingName(false)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, detail: false }))
    }
  }

  const deleteEvent = async () => {
    setDeleteDialogOpen(false)
    setBusy((c) => ({ ...c, detail: true }))
    try {
      const response = await fetch(`/api/owner/events/${selectedSlug}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to delete room')
      setMessage('Room deleted.')
      setSelectedEvent(null)
      setSelectedSlug('')
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, detail: false }))
    }
  }

  const loginWithPassword = async () => {
    setBusy((c) => ({ ...c, auth: true }))
    setMessage('')
    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Sign in failed')
      }
      setAuthState({ loading: false, authenticated: true, email: payload.email })
      setMessage('')
      identifyUser(payload.email)
      await loadEvents()
    } catch (error) {
      setMessage(error.message || 'Sign in failed')
    } finally {
      setBusy((c) => ({ ...c, auth: false }))
    }
  }

  const sendForgotLink = async () => {
    setForgotBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/owner/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Something went wrong')
      }
      setForgotSent(true)
      setMessage('')
    } catch (error) {
      setMessage(error.message || 'Something went wrong')
    } finally {
      setForgotBusy(false)
    }
  }

  const shareEvent = async (event) => {
    trackEvent(EVENT_ROOM_SHARED_FROM_DASHBOARD, { room_slug: event.slug })
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/event/${event.slug}`
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: event.name, url })
      } catch {
        // user cancelled
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setMessage('Link copied!')
        setTimeout(() => setMessage(''), 2000)
      } catch {
        setMessage('Unable to copy link')
      }
    } else {
      setMessage('Sharing not supported on this device')
    }
  }

  const openQR = (event) => {
    trackEvent(EVENT_ROOM_QR_OPENED_FROM_DASHBOARD, { room_slug: event.slug })
    setQrEvent(event)
    setQrOpen(true)
  }

  const startRename = (event) => {
    setEditingSlug(event.slug)
    setEditName(event.name)
  }

  const saveRename = async (slug) => {
    const trimmed = editName.trim()
    if (!trimmed || trimmed.length < 3) {
      setEditingSlug('')
      return
    }
    const original = events.find((e) => e.slug === slug)
    if (trimmed === original?.name) {
      setEditingSlug('')
      return
    }
    setBusy((c) => ({ ...c, detail: true }))
    try {
      const response = await fetch(`/api/owner/events/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to rename room')
      setMessage('Room renamed.')
      await loadEvents()
      if (selectedSlug === slug) {
        setSelectedEvent(payload.event)
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, detail: false }))
      setEditingSlug('')
    }
  }

  const cancelRename = () => {
    setEditingSlug('')
    setEditName('')
  }

  const startDelete = (event) => {
    setSelectedSlug(event.slug)
    setSelectedEvent(event)
    setDeleteDialogOpen(true)
  }

  const sendRecoveryLink = async () => {
    setRecoveryBusy(true)
    try {
      const response = await fetch('/api/owner/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: recoveryEmail.trim(),
          ...(redirectParam && redirectParam.startsWith('/') ? { redirect: redirectParam } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to send recovery link')
      setRecoverySent(true)
    } catch (error) {
      setMessage(error.message)
      setRecoverySent(true)
    } finally {
      setRecoveryBusy(false)
    }
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateError(null)
    setCreateDialogOpen(true)
  }

  const createRoom = async () => {
    const trimmed = createName.trim()
    if (!trimmed || trimmed.length < 3) {
      setCreateError({ error: 'Room name must be at least 3 characters' })
      return
    }

    trackEvent(EVENT_CREATE_ROOM_CLICKED, { page_type: 'dashboard', variant: 'modal' })

    setCreateBusy(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, ownerEmail: authState.email }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setCreateError(payload)
      } else if (payload.event?.slug) {
        setCreateDialogOpen(false)
        setCreateName('')
        setCreateError(null)
        await loadEvents()
        setSelectedSlug(payload.event.slug)
        setMessage(`Room "${payload.event.name}" created.`)
      }
    } catch (e) {
      setCreateError({ error: 'Unable to create room. Please try again.' })
    } finally {
      setCreateBusy(false)
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

  // Removed auto-redirect: dashboard now shows inline login card when not authenticated

  useEffect(() => {
    if (!authState.authenticated) return
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.authenticated])

  useEffect(() => {
    if (!authState.authenticated || !selectedSlug) return
    loadEventDetail(selectedSlug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.authenticated, selectedSlug])

  useEffect(() => {
    if (selectedEvent) {
      setNewEventName(selectedEvent.name)
      setIsEditingName(false)
    }
  }, [selectedEvent])

  useEffect(() => {
    if (!authState.authenticated) return
    loadPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.authenticated])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const upgrade = params.get('upgrade')
    if (upgrade === 'success') {
      const intent = params.get('intent')
      if (intent === 'professional') {
        setMessage('Welcome to Professional! Your subscription is being confirmed.')
      } else if (intent === 'high_quality_download') {
        setMessage('Original quality downloads unlocked! Your room is being updated.')
      } else {
        setMessage('Upgrade confirmed! Your event is being updated.')
      }
      loadPlan()
      loadEvents()
      // Clean URL without full reload
      router.replace('/dashboard', { scroll: false })
    } else if (upgrade === 'cancelled') {
      const intent = params.get('intent')
      setMessage('Upgrade cancelled. You can upgrade anytime.')
      if (intent === 'high_quality_download') {
        trackEvent(EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED, {
          pageType: 'dashboard',
          userRole: 'owner',
          plan: plan || 'free',
          billing_intent: intent,
        })
      } else {
        trackEvent(EVENT_CHECKOUT_CANCELLED, {
          pageType: 'dashboard',
          userRole: 'owner',
          plan: plan || 'free',
          billing_intent: intent,
        })
      }
      router.replace('/dashboard', { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="dark relative min-h-screen bg-background font-body text-foreground">
      {/* Subtle grid background for dashboard */}
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />

      <header className="relative z-10 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>
          {authState.authenticated ? (
            <div className="flex items-center gap-3">
              {(plan === 'professional' || plan === 'business') && (
                <span className="hidden rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-primary sm:inline">
                  Pro
                </span>
              )}
              <span className="hidden font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground sm:inline">
                {authState.email}
              </span>
              <Button variant="ghost" size="sm" onClick={logout} className="font-body text-muted-foreground hover:text-foreground">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" asChild className="font-body">
              <a href="/">Create room</a>
            </Button>
          )}
        </div>
      </header>

      <section className="container relative z-10 px-4 py-10 sm:py-16">
        {authState.loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authState.authenticated ? (
          <div className="mx-auto max-w-sm py-12">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Lock className="h-6 w-6" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-white">
                {forgotMode ? 'Reset your password' : 'Sign in to manage your rooms'}
              </h1>
              <p className="mt-3 text-sm font-light text-muted-foreground">
                {forgotMode
                  ? 'Enter your email and we\'ll send you a secure reset link.'
                  : 'Access your rooms, share them again, and manage uploads in one place.'}
              </p>
            </div>

            {forgotMode ? (
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="space-y-4">
                  {forgotSent ? (
                    <div className="rounded-xl border border-white/[0.07] bg-[#111827] p-4 text-sm text-muted-foreground text-center">
                      If that email is linked to an account, we&apos;ve sent a reset link.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">Email</label>
                        <Input
                          type="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="h-11 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && forgotEmail.trim()) sendForgotLink()
                          }}
                        />
                      </div>

                      {message && (
                        <p className="text-sm text-destructive">{message}</p>
                      )}

                      <Button
                        className="w-full h-11 glow-blue"
                        disabled={forgotBusy || !forgotEmail.trim()}
                        onClick={sendForgotLink}
                      >
                        {forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
                      </Button>
                    </>
                  )}

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                      onClick={() => {
                        setForgotMode(false)
                        setForgotEmail('')
                        setForgotSent(false)
                        setMessage('')
                      }}
                    >
                      Back to sign in
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] p-6 shadow-card">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email</label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-11 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Password</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="h-11 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && email.trim() && password) loginWithPassword()
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {message && (
                    <p className="text-sm text-destructive">{message}</p>
                  )}

                  <Button
                    className="w-full h-11 glow-blue"
                    disabled={busy.auth || !email.trim() || !password}
                    onClick={loginWithPassword}
                  >
                    {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                  </Button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                      onClick={() => {
                        setForgotMode(true)
                        setMessage('')
                        if (email.trim()) setForgotEmail(email.trim())
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Camera className="h-8 w-8" />
            </div>
            <h2 className="font-display text-xl font-bold tracking-tight text-white">
              You don&apos;t have any rooms yet
            </h2>
            <p className="mt-3 max-w-sm text-sm font-light text-muted-foreground">
              Create your first room and start collecting photos in seconds.
            </p>
            <Button className="mt-8 glow-blue" onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Create your room
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-8">
            {/* Top summary area */}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-white">
                  Your rooms
                </h1>
                <p className="mt-1 text-sm font-light text-muted-foreground">
                  Open, share, rename, or manage the rooms you&apos;ve created.
                </p>
              </div>
              <Button size="sm" className="mt-3 sm:mt-0 glow-blue" onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Create new room
              </Button>
            </div>

            {/* Upgrade entry point */}
            {plan !== 'professional' && plan !== 'business' && (
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card overflow-hidden">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                          Premium
                        </span>
                        <Sparkles className="h-3 w-3 text-primary" />
                      </div>
                      <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-white">
                        Unlock premium features
                      </h2>
                      <p className="mt-1 max-w-md text-sm font-light text-muted-foreground">
                        Upgrade individual events or go Professional for unlimited client work.
                      </p>
                      <p className="mt-2 text-xs font-light text-muted-foreground/70">
                        Guests always upload for free. You only pay for the features you need.
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:items-end">
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" asChild className="border-white/[0.07] bg-[#0D1220]">
                          <a href="/pricing">View pricing</a>
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        className="glow-blue"
                        disabled={checkoutBusy}
                        onClick={() => startCheckout('professional', null, 'dashboard_banner')}
                      >
                        {checkoutBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Start Professional'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {message ? (
              <div className="rounded-xl border border-white/[0.07] bg-[#141C2E] p-3 text-sm text-muted-foreground">{message}</div>
            ) : null}

            {/* Mono label above grid */}
            <div>
              <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                Rooms you created
              </span>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  onClick={() => {
                    trackEvent(EVENT_ROOM_SELECTED_IN_DASHBOARD, {
                      room_slug: event.slug,
                      room_name: event.name,
                      photo_count: event.photoCount || event.photos?.length || 0,
                    })
                    setSelectedSlug(event.slug)
                  }}
                  className={`group relative overflow-hidden rounded-2xl border bg-[#141C2E] transition-all duration-200 hover:-translate-y-px cursor-pointer ${
                    selectedSlug === event.slug
                      ? 'border-primary/40 shadow-[0_0_0_1px_rgba(212,168,83,0.15)]'
                      : 'border-white/[0.07] hover:border-white/[0.12]'
                  }`}
                >
                  <div className="p-5">
                    {editingSlug === event.slug ? (
                      <div className="space-y-3">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-9 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                          disabled={busy.detail}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(event.slug)
                            if (e.key === 'Escape') cancelRename()
                          }}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-8" disabled={busy.detail} onClick={() => saveRename(event.slug)}>
                            {busy.detail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={cancelRename}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="font-display text-base font-bold tracking-tight text-white truncate">
                          {event.name}
                        </h3>
                        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                          Code: {event.slug}
                        </p>
                        {event.billingTier && (
                          <div className="mt-1.5">
                            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                              <Sparkles className="mr-1 h-2.5 w-2.5" />
                              {event.billingTier === 'wedding_pro' ? 'Wedding Pro' : 'Pro Event'}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {editingSlug !== event.slug && (
                      <>
                        <p className="mt-3 text-sm font-light text-muted-foreground">
                          {event.photoCount || event.photos?.length || 0} photos
                        </p>

                        {/* Primary actions */}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button size="sm" asChild className="glow-blue" onClick={(e) => e.stopPropagation()}>
                            <a href={`/event/${event.slug}`}>Open room</a>
                          </Button>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); shareEvent(event) }} className="border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground">
                            <Share2 className="mr-1.5 h-3.5 w-3.5" />
                            Share
                          </Button>
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openQR(event) }} className="border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground">
                            <QrCode className="mr-1.5 h-3.5 w-3.5" />
                            QR
                          </Button>
                        </div>

                        {/* Tertiary actions */}
                        <div className="mt-4 flex gap-3 pt-4 border-t border-white/[0.07]">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-xs font-light text-muted-foreground hover:text-foreground transition-colors"
                            onClick={(e) => { e.stopPropagation(); startRename(event) }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 text-xs font-light text-destructive hover:text-destructive/80 transition-colors"
                            onClick={(e) => { e.stopPropagation(); startDelete(event) }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Photo moderation detail view */}
            {selectedEvent && (
              <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
                <div className="p-5 sm:p-6">
                  {/* Room context header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                        Room photos
                      </span>
                      <h3 className="mt-1 font-display text-lg font-bold tracking-tight text-white">
                        {selectedEvent.name}
                      </h3>
                      <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                        Code: {selectedEvent.slug}
                      </p>
                      <p className="mt-1 text-sm font-light text-muted-foreground">
                        {photos.length} total photos
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild className="glow-blue">
                        <a href={`/event/${selectedEvent.slug}`}>Open room</a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareEvent(selectedEvent)} className="border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground">
                        <Share2 className="mr-1.5 h-3.5 w-3.5" />
                        Share
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openQR(selectedEvent)} className="border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground">
                        <QrCode className="mr-1.5 h-3.5 w-3.5" />
                        QR
                      </Button>
                    </div>
                    {/* Event-level upgrade for free-tier rooms */}
                    {plan !== 'professional' && plan !== 'business' && !selectedEvent.billingTier && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                          disabled={checkoutBusy}
                          onClick={() => startCheckout('pro_event', selectedEvent.id, 'dashboard_room_detail')}
                        >
                          {checkoutBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pro Event €29'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                          disabled={checkoutBusy}
                          onClick={() => startCheckout('wedding_pro', selectedEvent.id, 'dashboard_room_detail')}
                        >
                          {checkoutBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Wedding Pro €49'}
                        </Button>
                      </div>
                    )}
                    {selectedEvent.billingTier && (
                      <div className="mt-2">
                        <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          <Sparkles className="mr-1 h-3 w-3" />
                          {selectedEvent.billingTier === 'wedding_pro' ? 'Wedding Pro' : 'Pro Event'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    {busy.detail ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading photos...
                      </div>
                    ) : photos.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/[0.07] bg-[#0D1220] p-8 text-center">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                        <p className="text-sm font-light text-muted-foreground">
                          No photos uploaded to this room yet.
                        </p>
                        <p className="mt-1 text-xs font-light text-muted-foreground/70">
                          Share the room link so guests can start adding photos.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        {photos.map((photo, index) => (
                          <DashboardPhotoCard
                            key={photo.id}
                            busyId={busy.photoId}
                            photo={photo}
                            onApprove={() => moderatePhoto(photo.id, 'approve')}
                            onDelete={() => deletePhoto(photo.id)}
                            onOpenLightbox={() => {
                              setLightboxIndex(index)
                              setLightboxOpen(true)
                            }}
                            onReject={() => moderatePhoto(photo.id, 'reject')}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <EventQRModal isOpen={qrOpen} onClose={() => setQrOpen(false)} event={qrEvent} />

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={photos}
        selectedIndex={lightboxIndex}
        event={selectedEvent ? { ...selectedEvent, ownerPlan: plan } : null}
        isOwner={true}
      />

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="border-white/[0.07] bg-[#141C2E]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-white">Create new room</DialogTitle>
            <DialogDescription className="text-sm font-light text-muted-foreground">
              Enter a name for your new room. Guests will see this name when they visit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Room name</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Sarah & Mike Wedding"
                className="h-11 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && createName.trim().length >= 3 && !createBusy) createRoom()
                }}
                autoFocus
              />
            </div>
            {createError?.limit === 'room_count' ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{createError.error}</p>
                <Button
                  className="w-full glow-blue"
                  disabled={checkoutBusy}
                  onClick={() => startCheckout('professional', null, 'dashboard_create_room_limit')}
                >
                  {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Upgrade to Professional'}
                </Button>
              </div>
            ) : createError?.error ? (
              <p className="text-sm text-destructive">{createError.error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              className="glow-blue"
              disabled={createBusy || !createName.trim() || createName.trim().length < 3}
              onClick={createRoom}
            >
              {createBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="border-white/[0.07] bg-[#141C2E]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-bold text-white">Delete room?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-light text-muted-foreground">
              This will permanently delete <strong className="text-foreground">{selectedEvent?.name}</strong> and all {selectedEvent?.photos?.length || 0} photos. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)} className="border-white/[0.07] bg-[#0D1220] text-foreground hover:bg-[#111827] hover:text-foreground">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteEvent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="relative z-10 border-t border-white/[0.07] bg-[#0D1220] py-8">
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
              <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
