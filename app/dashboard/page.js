'use client'

import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Loader2, Lock, LogOut, Shield, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PhotoLightbox from '@/components/photo-lightbox'

const DashboardPhotoCard = ({ photo, onApprove, onReject, onDelete, onOpenLightbox, busyId }) => {
  const isBusy = busyId === photo.id

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card">
      <button className="block w-full text-left" onClick={onOpenLightbox} type="button">
        <img alt={photo.originalName} className="aspect-square w-full object-cover" src={photo.url} />
      </button>
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{photo.originalName}</p>
            <p className="truncate text-xs text-muted-foreground">{photo.uploaderName || 'Guest upload'}</p>
          </div>
          <Badge variant={photo.status === 'VISIBLE' ? 'default' : 'secondary'} className="rounded-full capitalize">
            {photo.status.toLowerCase()}
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button disabled={isBusy || photo.status === 'VISIBLE'} size="sm" onClick={onApprove}>
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button disabled={isBusy || photo.status === 'HIDDEN'} size="sm" variant="secondary" onClick={onReject}>
            <EyeOff className="h-4 w-4" />
          </Button>
          <Button disabled={isBusy} size="sm" variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
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

  const photos = useMemo(() => selectedEvent?.photos || [], [selectedEvent])

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

  useEffect(() => {
    loadSession()
  }, [])

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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-gradient-to-b from-background to-muted/40">
        <div className="container px-4 py-8 sm:py-10">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Shield className="h-6 w-6" />
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your rooms</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Manage the rooms you own, review uploads, and hide or delete photos.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" className="rounded-full">
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
              <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">{message}</div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="container grid gap-6 px-4 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lock className="h-5 w-5 text-primary" />
              {authState.loading ? 'Checking access' : authState.authenticated ? 'Access granted' : 'Sign in to your rooms'}
            </CardTitle>
            <CardDescription>
              {authState.authenticated
                ? 'You are signed in to manage your rooms.'
                : 'Enter the email and management token from your room claim email.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {authState.loading ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading session...
              </div>
            ) : authState.authenticated ? (
              <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                You are signed in as <strong>{authState.email}</strong>. Select a room to manage photos.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Management token</label>
                  <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your token" />
                </div>
                <Button className="w-full" disabled={busy.auth || !email.trim() || !token.trim()} onClick={login}>
                  {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="text-lg">Your rooms</CardTitle>
                <CardDescription>Open a room to review every photo, including hidden ones.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!authState.authenticated ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    Sign in to see your rooms.
                  </div>
                ) : events.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                    You don&apos;t own any rooms yet.
                  </div>
                ) : (
                  events.map((event) => (
                    <button
                      key={event.id}
                      className={`w-full rounded-2xl border p-3 text-left transition ${selectedSlug === event.slug ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
                      onClick={() => setSelectedSlug(event.slug)}
                      type="button"
                    >
                      <p className="truncate text-sm font-medium">{event.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{event.slug}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{event.photoCount} public photos</p>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="text-lg">Room photos</CardTitle>
                <CardDescription>{selectedEvent ? `${selectedEvent.name} • ${photos.length} total photos` : 'Select a room to manage photos.'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {busy.detail && !selectedEvent ? (
                  <div className="rounded-2xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">Loading room detail...</div>
                ) : selectedEvent ? (
                  <>
                    <div className="rounded-2xl border border-border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-lg font-semibold">{selectedEvent.name}</p>
                          <p className="text-sm text-muted-foreground">Share code: {selectedEvent.slug}</p>
                        </div>
                        <Badge variant="secondary" className="rounded-full">{photos.length} total</Badge>
                      </div>
                    </div>

                    {photos.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                        No photos uploaded to this room yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
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
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                    Sign in and select a room to start managing photos.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={photos}
        selectedIndex={lightboxIndex}
      />
    </main>
  )
}
