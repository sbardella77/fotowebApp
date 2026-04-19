'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Eye, EyeOff, Loader2, Lock, LogOut, Pencil, QrCode, Share2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
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
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/event/${event.slug}`
    if (navigator.share) {
      try {
        await navigator.share({ title: event.name, url })
      } catch {
        // user cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        setMessage('Link copied!')
        setTimeout(() => setMessage(''), 2000)
      } catch {
        setMessage('Unable to copy link')
      }
    }
  }

  const openQR = (event) => {
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src="/snaprooms-logo.svg" alt="SnapRooms" className="h-8 w-8 rounded-md object-cover" />
            <span className="font-semibold tracking-tight">SnapRooms</span>
          </div>
          {authState.authenticated ? (
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:inline">{authState.email}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" asChild>
              <a href="/">Create room</a>
            </Button>
          )}
        </div>
      </header>

      <section className="container px-4 py-8">
        {authState.loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !authState.authenticated ? (
          <div className="mx-auto max-w-sm py-12">
            <div className="mb-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Lock className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {forgotMode ? 'Reset your password' : 'Sign in to manage your rooms'}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {forgotMode
                  ? 'Enter your email and we\'ll send you a secure reset link.'
                  : 'Enter your email and password to continue.'}
              </p>
            </div>

            {forgotMode ? (
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <div className="text-center">
                    <h2 className="text-lg font-semibold">Reset your password</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Enter your email and we&apos;ll send you a secure reset link.
                    </p>
                  </div>

                  {forgotSent ? (
                    <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
                      If that email is linked to an account, we&apos;ve sent a reset link.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <Input
                          type="email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="you@example.com"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && forgotEmail.trim()) sendForgotLink()
                          }}
                        />
                      </div>

                      {message && (
                        <p className="text-sm text-destructive">{message}</p>
                      )}

                      <Button
                        className="w-full"
                        disabled={forgotBusy || !forgotEmail.trim()}
                        onClick={sendForgotLink}
                      >
                        {forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
                      </Button>
                    </>
                  )}

                  <div className="text-center">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
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
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email</label>
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Password</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && email.trim() && password) loginWithPassword()
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {message && (
                    <p className="text-sm text-destructive">{message}</p>
                  )}

                  <Button className="w-full" disabled={busy.auth || !email.trim() || !password} onClick={loginWithPassword}>
                    {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                      onClick={() => {
                        setForgotMode(true)
                        setMessage('')
                        if (email.trim()) setForgotEmail(email.trim())
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Camera className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-semibold">You don&apos;t have any rooms yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create your first room to start collecting photos.</p>
            <Button className="mt-6" asChild>
              <a href="/">Create your room</a>
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Your rooms</h1>
              <p className="mt-1 text-sm text-muted-foreground">Manage and share the rooms you own.</p>
            </div>

            {message ? (
              <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">{message}</div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((event) => (
                <Card key={event.id} className="border-border/80">
                  <CardHeader className="pb-3">
                    {editingSlug === event.slug ? (
                      <div className="space-y-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-9"
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
                        <CardTitle className="text-base font-semibold">{event.name}</CardTitle>
                        <CardDescription>Code: {event.slug}</CardDescription>
                      </>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{event.photoCount || event.photos?.length || 0} photos</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <a href={`/event/${event.slug}`}>Open room</a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => shareEvent(event)}>
                        <Share2 className="mr-1.5 h-3.5 w-3.5" />
                        Share
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openQR(event)}>
                        <QrCode className="mr-1.5 h-3.5 w-3.5" />
                        QR
                      </Button>
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-border/50">
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => startRename(event)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => startDelete(event)}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Photo moderation detail view kept for selected room */}
            {selectedEvent && (
              <Card className="border-border/80">
                <CardHeader>
                  <CardTitle className="text-lg">Room photos</CardTitle>
                  <CardDescription>{selectedEvent.name} • {photos.length} total photos</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {busy.detail ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading photos...
                    </div>
                  ) : photos.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
                      No photos uploaded to this room yet.
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
                </CardContent>
              </Card>
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
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete room?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{selectedEvent?.name}</strong> and all {selectedEvent?.photos?.length || 0} photos. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteEvent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="border-t py-6">
        <div className="container px-4">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              SnapRooms — Every guest photo. One room.
            </p>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="text-xs text-muted-foreground hover:text-foreground">
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
