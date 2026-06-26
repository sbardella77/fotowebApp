'use client'

import { useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, Eye, EyeOff, ImagePlus, Loader2, Lock, LogOut, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { Input } from '@/components/ui/input'
import PhotoLightbox from '@/components/photo-lightbox'
import { csrfFetch } from '@/lib/client/csrf-fetch'

const AdminPhotoCard = ({ photo, onApprove, onReject, onDelete, onOpenLightbox, busyId }) => {
  const isBusy = busyId === photo.id

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <button className="block w-full text-left" onClick={onOpenLightbox} type="button">
        <img alt={photo.originalName} className="aspect-square w-full object-cover" src={photo.url} />
      </button>
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{photo.originalName}</p>
            <p className="truncate text-xs text-muted-foreground">{photo.uploaderName || 'Guest upload'}</p>
          </div>
          <Badge variant={photo.status === 'VISIBLE' ? 'default' : 'secondary'} className="rounded-full capitalize font-mono text-[0.6rem]">
            {photo.status.toLowerCase()}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button disabled={isBusy || photo.status === 'VISIBLE'} size="sm" onClick={onApprove} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button disabled={isBusy || photo.status === 'HIDDEN'} size="sm" variant="secondary" onClick={onReject} className="bg-raised text-foreground hover:bg-elevated">
            <EyeOff className="h-4 w-4" />
          </Button>
          <Button disabled={isBusy} size="sm" variant="destructive" onClick={() => { if (typeof window !== 'undefined' && window.confirm('Permanently delete this photo?')) onDelete() }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [authState, setAuthState] = useState({ loading: true, configured: false, authenticated: false, source: null })
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [events, setEvents] = useState([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [newEventName, setNewEventName] = useState('Wedding Reception')
  const [busy, setBusy] = useState({ auth: false, create: false, detail: false, photoId: '' })
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const photos = useMemo(() => selectedEvent?.photos || [], [selectedEvent])

  const loadSession = async () => {
    setAuthState((current) => ({ ...current, loading: true }))

    try {
      const response = await fetch('/api/admin/session', { cache: 'no-store' })
      const payload = await response.json()
      setAuthState({
        loading: false,
        configured: payload.configured,
        authenticated: payload.authenticated,
        source: payload.source,
      })

      if (payload.authenticated) {
        setMessage('Admin session ready.')
      }
    } catch (error) {
      setAuthState((current) => ({ ...current, loading: false }))
      setMessage(error.message || 'Unable to load admin session')
    }
  }

  const loadEvents = async () => {
    try {
      const response = await fetch('/api/admin/events', { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load events')
      }

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
    if (!slug) {
      return
    }

    setBusy((current) => ({ ...current, detail: true }))

    try {
      const response = await fetch(`/api/admin/events/${slug}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load event detail')
      }

      setSelectedEvent(payload.event)
      setSelectedSlug(payload.event.slug)
      setMessage(`Viewing ${payload.event.name}. Hidden photos stay visible here for moderation.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((current) => ({ ...current, detail: false }))
    }
  }

  const submitAuth = async (mode) => {
    setBusy((current) => ({ ...current, auth: true }))

    try {
      const endpoint = mode === 'setup' ? '/api/admin/setup' : '/api/admin/login'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Authentication failed')
      }

      setPassword('')
      setAuthState({ loading: false, configured: true, authenticated: true, source: payload.source })
      setMessage(mode === 'setup' ? 'Admin password created. You are now signed in.' : 'Signed in to admin.')
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((current) => ({ ...current, auth: false }))
    }
  }

  const logout = async () => {
    await csrfFetch('/api/admin/logout', { method: 'POST' })
    setSelectedEvent(null)
    setSelectedSlug('')
    setEvents([])
    setAuthState((current) => ({ ...current, authenticated: false }))
    setMessage('Signed out from admin.')
  }

  const createEvent = async () => {
    setBusy((current) => ({ ...current, create: true }))

    try {
      const response = await csrfFetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newEventName }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create event')
      }

      setSelectedSlug(payload.event.slug)
      await loadEvents()
      await loadEventDetail(payload.event.slug)
      setMessage(`Created ${payload.event.name}.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((current) => ({ ...current, create: false }))
    }
  }

  const moderatePhoto = async (photoId, action) => {
    setBusy((current) => ({ ...current, photoId }))

    try {
      const response = await csrfFetch(`/api/admin/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to update photo')
      }

      setMessage(action === 'approve' ? 'Photo approved.' : 'Photo hidden from the public gallery.')
      await loadEventDetail(selectedSlug)
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((current) => ({ ...current, photoId: '' }))
    }
  }

  const deletePhoto = async (photoId) => {
    setBusy((current) => ({ ...current, photoId }))

    try {
      const response = await csrfFetch(`/api/admin/photos/${photoId}`, {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to delete photo')
      }

      setMessage('Photo deleted.')
      await loadEventDetail(selectedSlug)
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((current) => ({ ...current, photoId: '' }))
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

  useEffect(() => {
    if (!authState.authenticated) {
      return
    }

    loadEvents()
  }, [authState.authenticated])

  useEffect(() => {
    if (!authState.authenticated || !selectedSlug) {
      return
    }

    loadEventDetail(selectedSlug)
  }, [authState.authenticated, selectedSlug])

  return (
    <main className="relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" />

      <header className="relative z-10 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container px-4 py-8 sm:py-10">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Shield className="h-5 w-5" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Admin moderation
                </h1>
                <p className="mt-2 max-w-2xl text-sm font-light text-muted-foreground sm:text-base">
                  Password-protected system panel for creating events, reviewing uploads, and hiding or deleting photos.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-border bg-surface px-3 py-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">
                  {authState.source ? `${authState.source} auth` : 'not configured'}
                </Badge>
                <Button asChild variant="outline" className="rounded-full border-border bg-surface hover:bg-elevated hover:text-foreground">
                  <a href="/">Back to gallery</a>
                </Button>
                {authState.authenticated ? (
                  <Button variant="secondary" className="rounded-full" onClick={logout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </Button>
                ) : null}
              </div>
            </div>

            {message ? (
              <div className="rounded-xl border border-border bg-surface p-4 text-sm font-light text-muted-foreground">
                {message}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="container relative z-10 grid gap-6 px-4 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-surface shadow-card">
          <div className="p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-foreground">
              <Lock className="h-5 w-5 text-primary" />
              {authState.loading ? 'Checking admin access' : authState.authenticated ? 'Admin access granted' : authState.configured ? 'Admin login' : 'Set admin password'}
            </h2>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              {authState.configured
                ? 'Use your admin password to moderate photos.'
                : 'First-time local setup stores a hashed password on disk until env-based auth is added.'}
            </p>
            <div className="mt-4 space-y-4">
              {authState.loading ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-raised p-4 text-sm font-light text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading admin state...
                </div>
              ) : authState.authenticated ? (
                <div className="flex items-start gap-3 rounded-xl border border-border bg-raised p-4 text-sm font-light text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                  You are signed in. Create events and moderate photos from the dashboard.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Password</label>
                    <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter admin password" className="border-border bg-raised text-foreground placeholder:text-muted-foreground/60" />
                  </div>
                  {!authState.configured ? (
                    <Button className="w-full cta-primary" disabled={busy.auth} onClick={() => submitAuth('setup')}>
                      {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create admin password'}
                    </Button>
                  ) : (
                    <Button className="w-full cta-primary" disabled={busy.auth} onClick={() => submitAuth('login')}>
                      {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="p-5 sm:p-6">
              <h2 className="font-display text-base font-bold tracking-tight text-foreground">
                Create event
              </h2>
              <p className="mt-1 text-sm font-light text-muted-foreground">
                Create event codes from the admin panel for staff-led workflows.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <Input value={newEventName} onChange={(event) => setNewEventName(event.target.value)} placeholder="Wedding Reception" className="border-border bg-raised text-foreground placeholder:text-muted-foreground/60" />
                <Button disabled={!authState.authenticated || busy.create} onClick={createEvent} className="cta-primary">
                  {busy.create ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create event'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <div className="p-5 sm:p-6">
                <h2 className="font-display text-base font-bold tracking-tight text-foreground">
                  Events
                </h2>
                <p className="mt-1 text-sm font-light text-muted-foreground">
                  Open an event to review every photo, including hidden ones.
                </p>
                <div className="mt-4 space-y-3">
                  {events.length === 0 ? (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-raised p-6 text-center">
                      <Camera className="mb-2 h-5 w-5 text-muted-foreground/50" />
                      <p className="text-sm font-light text-muted-foreground">No events yet.</p>
                    </div>
                  ) : (
                    events.map((event) => (
                      <button
                        key={event.id}
                        className={`w-full rounded-xl border p-3 text-left transition ${selectedSlug === event.slug ? 'border-primary bg-primary/[0.08]' : 'border-border bg-raised hover:border-border'}`}
                        onClick={() => setSelectedSlug(event.slug)}
                        type="button"
                      >
                        <p className="truncate text-sm font-medium text-foreground">{event.name}</p>
                        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">{event.slug}</p>
                        <p className="mt-2 text-xs font-light text-muted-foreground">{event.photoCount} public photos</p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <div className="p-5 sm:p-6">
                <h2 className="font-display text-base font-bold tracking-tight text-foreground">
                  Event detail
                </h2>
                <p className="mt-1 text-sm font-light text-muted-foreground">
                  {selectedEvent ? `${selectedEvent.name} • ${photos.length} total photos in moderation view` : 'Select an event to moderate photos.'}
                </p>
                <div className="mt-4 space-y-4">
                  {busy.detail && !selectedEvent ? (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-raised p-4 text-sm font-light text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading event detail...
                    </div>
                  ) : selectedEvent ? (
                    <>
                      <div className="rounded-xl border border-border bg-raised p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-accent-dark">Moderating</span>
                            <p className="mt-0.5 font-display text-base font-bold tracking-tight text-foreground">{selectedEvent.name}</p>
                            <p className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">Code: {selectedEvent.slug}</p>
                          </div>
                          <Badge variant="secondary" className="rounded-full bg-raised text-foreground font-mono text-[0.6rem]">{photos.length} total</Badge>
                        </div>
                      </div>

                      {photos.length === 0 ? (
                        <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-raised p-8 text-center">
                          <ImagePlus className="mb-3 h-6 w-6 text-muted-foreground/40" />
                          <p className="text-sm font-light text-muted-foreground">No photos uploaded to this event yet.</p>
                          <p className="mt-1 text-xs font-light text-muted-foreground/70">Share the event link so guests can start adding photos.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                          {photos.map((photo, index) => (
                            <AdminPhotoCard
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
                    </>
                  ) : (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-raised p-8 text-center">
                      <Shield className="mb-3 h-6 w-6 text-muted-foreground/40" />
                      <p className="text-sm font-light text-muted-foreground">Sign in and select an event to start moderating.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={photos}
        selectedIndex={lightboxIndex}
        isOwner={true}
      />
    </main>
  )
}

export default App
