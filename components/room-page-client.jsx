'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock3,
  Copy,
  ImagePlus,
  Loader2,
  Mail,
  QrCode,
  RefreshCcw,
  Share2,
  Users,
} from 'lucide-react'
import PhotoGalleryGrid from '@/components/photo-gallery-grid'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const CHUNK_SIZE = 1024 * 1024

const useToast = () => {
  const [toast, setToast] = useState(null)

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }

  const ToastComponent = () => {
    if (!toast) return null

    return (
      <div
        className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
          toast.type === 'success'
            ? 'bg-foreground text-background'
            : 'bg-destructive text-destructive-foreground'
        }`}
      >
        {toast.message}
      </div>
    )
  }

  return { showToast, ToastComponent }
}

function SaveEventCard({ event, onDismiss, onClaim }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isValid) return
    setStatus('loading')
    setError('')
    try {
      const [emailRes, ownerRes] = await Promise.all([
        fetch(`/api/events/${event.slug}/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        }),
        fetch(`/api/events/${event.slug}/owner`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        }),
      ])
      const emailPayload = await emailRes.json()
      const ownerPayload = await ownerRes.json()
      if (!emailRes.ok) {
        throw new Error(emailPayload.error || 'Unable to send email')
      }
      if (!ownerRes.ok) {
        throw new Error(ownerPayload.error || 'Unable to claim room')
      }
      onClaim?.(email.trim(), ownerPayload.managementToken)
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Something went wrong')
    }
  }

  if (status === 'success') {
    return (
      <Card className="mt-6 border-green-200 bg-green-50/50">
        <CardContent className="flex items-center gap-3 py-6">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900">Room link sent!</p>
            <p className="text-sm text-green-700">Check your inbox for {email.trim()}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6 border-border/50 bg-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Save this room
        </CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you the room link so you can open it later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 flex-1"
            disabled={status === 'loading'}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!isValid || status === 'loading'}
            className="h-10 whitespace-nowrap"
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Send me the link'
            )}
          </Button>
        </form>
        {status === 'error' && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <div className="flex flex-col-reverse items-start justify-between gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            Optional — you can keep using SnapRooms without this.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={onDismiss}
            disabled={status === 'loading'}
          >
            Skip for now
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ClaimRoomCard({ event, onClaim }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isValid) return
    setStatus('loading')
    setError('')
    try {
      const response = await fetch(`/api/events/${event.slug}/owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to claim room')
      }
      onClaim(email.trim(), payload.managementToken)
      setStatus('success')
    } catch (err) {
      setStatus('error')
      setError(err.message || 'Something went wrong')
    }
  }

  if (status === 'success') {
    return (
      <Card className="mt-6 border-green-200 bg-green-50/50">
        <CardContent className="flex items-center gap-3 py-6">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          <div>
            <p className="font-medium text-green-900">Room claimed!</p>
            <p className="text-sm text-green-700">You can manage this room anytime.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6 border-border/50 bg-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          Claim this room
        </CardTitle>
        <CardDescription>
          Enter your email to become the owner and manage this room later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 flex-1"
            disabled={status === 'loading'}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!isValid || status === 'loading'}
            className="h-10 whitespace-nowrap"
          >
            {status === 'loading' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Claim room'
            )}
          </Button>
        </form>
        {status === 'error' && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Optional — you can keep using SnapRooms without this.
        </p>
      </CardContent>
    </Card>
  )
}

function RoomManagementCard({ event, managementToken, onEventUpdated, onEventDeleted, showToast }) {
  const [isEditing, setIsEditing] = useState(false)
  const [newName, setNewName] = useState(event.name)
  const [busy, setBusy] = useState({ rename: false, delete: false })

  const handleRename = async (e) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed || trimmed.length < 3 || trimmed === event.name) {
      setIsEditing(false)
      return
    }
    setBusy((c) => ({ ...c, rename: true }))
    try {
      const response = await fetch(`/api/events/${event.slug}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${managementToken}`,
        },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to rename room')
      }
      onEventUpdated(payload.event)
      showToast('Room renamed!')
      setIsEditing(false)
    } catch (err) {
      showToast(err.message || 'Rename failed', 'error')
    } finally {
      setBusy((c) => ({ ...c, rename: false }))
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this room and all its photos? This cannot be undone.')) {
      return
    }
    setBusy((c) => ({ ...c, delete: true }))
    try {
      const response = await fetch(`/api/events/${event.slug}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${managementToken}`,
        },
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to delete room')
      }
      showToast('Room deleted')
      onEventDeleted()
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    } finally {
      setBusy((c) => ({ ...c, delete: false }))
    }
  }

  return (
    <Card className="mt-6 border-border/50 bg-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Room settings</CardTitle>
        <CardDescription>Manage your room name or delete it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <form onSubmit={handleRename} className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-10 flex-1"
              disabled={busy.rename}
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy.rename} className="h-10">
                {busy.rename ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy.rename}
                className="h-10"
                onClick={() => {
                  setNewName(event.name)
                  setIsEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Room name</p>
              <p className="truncate text-sm text-muted-foreground">{event.name}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setIsEditing(true)}
            >
              Rename
            </Button>
          </div>
        )}
        <div className="pt-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleDelete}
            disabled={busy.delete}
          >
            {busy.delete ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete room'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function RoomNotFound() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-5 px-4 text-center">
      <img
        src="/snaprooms-logo.svg"
        alt="SnapRooms"
        className="h-12 w-12 rounded-lg object-cover"
      />
      <div className="max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Room not found</h1>
        <p className="mt-2 text-muted-foreground">
          The room you&apos;re looking for doesn&apos;t exist or may have been removed.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Check the link or ask the organizer to share it again.
        </p>
      </div>
      <Button asChild>
        <a href="/">Back to home</a>
      </Button>
    </div>
  )
}

export default function RoomPageClient({ slug }) {
  const router = useRouter()
  const [guestName, setGuestName] = useState('')
  const [activeEvent, setActiveEvent] = useState(null)
  const [uploads, setUploads] = useState([])
  const [busy, setBusy] = useState({ join: true, refresh: false })
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryError, setGalleryError] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [saveEmailDismissed, setSaveEmailDismissed] = useState(false)
  const [claimedEmail, setClaimedEmail] = useState('')
  const [managementToken, setManagementToken] = useState('')
  const [notFound, setNotFound] = useState(false)
  const { showToast, ToastComponent } = useToast()

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const galleryPhotos = useMemo(() => {
    return [...(activeEvent?.photos || [])].sort(
      (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
    )
  }, [activeEvent])

  const isOwner = useMemo(() => {
    if (!activeEvent?.ownerEmail || !claimedEmail || !managementToken) return false
    return activeEvent.ownerEmail.toLowerCase() === claimedEmail.toLowerCase()
  }, [activeEvent, claimedEmail, managementToken])

  const loadEvent = async (targetSlug, { silent = false } = {}) => {
    if (!targetSlug) return

    setGalleryError('')

    if (silent) {
      setBusy((current) => ({ ...current, refresh: true }))
    } else {
      setBusy((current) => ({ ...current, join: true }))
      setGalleryLoading(true)
    }

    try {
      const response = await fetch(`/api/events/${targetSlug}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        if (response.status === 404) {
          setNotFound(true)
        }
        throw new Error(payload.error || 'Unable to open gallery')
      }

      setActiveEvent(payload.event)
    } catch (error) {
      setGalleryError(error.message || 'Unable to load gallery')
    } finally {
      if (silent) {
        setBusy((current) => ({ ...current, refresh: false }))
      } else {
        setBusy((current) => ({ ...current, join: false }))
        setGalleryLoading(false)
      }
    }
  }

  const uploadSingleFile = async (file) => {
    if (!activeEvent?.slug) return

    const localId = `${file.name}-${file.lastModified}`

    setUploads((current) => [
      {
        id: localId,
        name: file.name,
        size: file.size,
        progress: 2,
        status: 'Preparing upload',
      },
      ...current,
    ])

    const updateUpload = (next) => {
      setUploads((current) =>
        current.map((item) => {
          if (item.id !== localId) return item
          return { ...item, ...next }
        }),
      )
    }

    try {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const initResponse = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug: activeEvent.slug,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'image/jpeg',
          totalChunks,
        }),
      })
      const initPayload = await initResponse.json()

      if (!initResponse.ok) {
        throw new Error(initPayload.error || 'Unable to initialize upload')
      }

      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        updateUpload({ progress: 8, status: 'Uploading to event gallery storage' })

        const blob = await upload(initPayload.session.pathname || file.name, file, {
          access: 'public',
          handleUploadUrl: initPayload.session.handleUploadUrl || '/api/uploads/blob',
          clientPayload: JSON.stringify({
            eventSlug: activeEvent.slug,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'image/jpeg',
          }),
          multipart: file.size > 5 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => {
            const progress = 10 + Math.round((percentage / 100) * 75)
            updateUpload({ progress, status: `Uploaded ${Math.round(percentage)}%` })
          },
        })

        updateUpload({ progress: 90, status: 'Finalizing gallery entry' })

        const completeResponse = await fetch('/api/uploads/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventSlug: activeEvent.slug,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            originalName: file.name,
            mimeType: file.type || 'image/jpeg',
            size: file.size,
            uploaderName: guestName,
            caption: '',
          }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || 'Unable to finalize upload')
        }

        updateUpload({ progress: 100, status: 'Done' })
        setActiveEvent(completePayload.event)
        setGalleryError('')
        return
      }

      updateUpload({ progress: 8, status: 'Uploading...' })

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunkBlob = file.slice(start, end)

        const formData = new FormData()
        formData.append('sessionId', initPayload.session.sessionId)
        formData.append('chunkIndex', String(chunkIndex))
        formData.append('totalChunks', String(totalChunks))
        formData.append('chunk', chunkBlob, `${file.name}.part-${chunkIndex}`)

        const chunkResponse = await fetch('/api/uploads/chunk', {
          method: 'POST',
          body: formData,
        })
        const chunkPayload = await chunkResponse.json()

        if (!chunkResponse.ok) {
          throw new Error(chunkPayload.error || `Chunk ${chunkIndex + 1} failed`)
        }

        const chunkProgress = 10 + Math.round(((chunkIndex + 1) / totalChunks) * 75)
        updateUpload({
          progress: chunkProgress,
          status: `Uploaded ${chunkIndex + 1}/${totalChunks} chunks`,
        })
      }

      const completeResponse = await fetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: initPayload.session.sessionId,
          uploaderName: guestName,
          caption: '',
        }),
      })
      const completePayload = await completeResponse.json()

      if (!completeResponse.ok) {
        throw new Error(completePayload.error || 'Unable to finalize upload')
      }

      updateUpload({ progress: 100, status: 'Done' })
      setActiveEvent(completePayload.event)
      setGalleryError('')
    } catch (error) {
      console.error('Upload failed', error)
      updateUpload({ status: 'Failed' })
    }
  }

  const onFilesSelected = async (event) => {
    const fileList = Array.from(event.target.files || [])
    if (fileList.length === 0) return

    for (const file of fileList) {
      await uploadSingleFile(file)
    }

    event.target.value = ''
  }

  const openLightbox = (index) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  useEffect(() => {
    loadEvent(slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(() => {
    if (!activeEvent?.slug) return undefined

    if (typeof window !== 'undefined') {
      const ownerKey = `snaprooms:owner:${activeEvent.slug}`
      const legacyKey = `snaprooms:claimed:${activeEvent.slug}`
      const stored = window.localStorage.getItem(ownerKey)
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          if (parsed.email) setClaimedEmail(parsed.email)
          if (parsed.token) setManagementToken(parsed.token)
        } catch {
          // ignore parse errors
        }
      } else {
        const legacy = window.localStorage.getItem(legacyKey)
        if (legacy) {
          setClaimedEmail(legacy)
        }
      }
    }

    const interval = window.setInterval(() => {
      loadEvent(activeEvent.slug, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug])

  const handleClaimRoom = (email, token) => {
    setClaimedEmail(email)
    setManagementToken(token)
    if (activeEvent?.slug && typeof window !== 'undefined') {
      window.localStorage.setItem(
        `snaprooms:owner:${activeEvent.slug}`,
        JSON.stringify({ email, token }),
      )
      window.localStorage.removeItem(`snaprooms:claimed:${activeEvent.slug}`)
    }
  }

  const handleEventUpdated = (event) => {
    setActiveEvent(event)
  }

  const handleEventDeleted = () => {
    if (activeEvent?.slug && typeof window !== 'undefined') {
      window.localStorage.removeItem(`snaprooms:owner:${activeEvent.slug}`)
      window.localStorage.removeItem(`snaprooms:claimed:${activeEvent.slug}`)
    }
    setClaimedEmail('')
    setManagementToken('')
    setActiveEvent(null)
    router.push('/')
  }

  if (notFound) {
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
              <a href="/dashboard">Dashboard</a>
            </Button>
          </div>
        </header>
        <RoomNotFound />
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
            <a href="/dashboard">Dashboard</a>
          </Button>
        </div>
      </header>

      {busy.join && !activeEvent ? (
        <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-4">
          <img
            src="/snaprooms-logo.svg"
            alt="SnapRooms"
            className="h-12 w-12 rounded-lg object-cover"
          />
          <p className="text-lg font-medium text-foreground">Opening your room...</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <section className="container px-4 pb-12">
          <div className="mx-auto max-w-4xl">
            <Card className="border-border/50 shadow-sm">
              <CardHeader className="space-y-1">
                <CardTitle className="text-xl font-semibold">{activeEvent.name}</CardTitle>
                <CardDescription>Room code: {activeEvent.slug}</CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 p-6 text-center">
                    <div className="absolute right-2 top-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => loadEvent(activeEvent.slug, { silent: true })}
                      >
                        <RefreshCcw className={`h-4 w-4 ${busy.refresh ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>

                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Room code
                    </p>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                      {activeEvent.slug}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Share this code so guests can join
                    </p>

                    <div className="mt-4 flex justify-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(activeEvent.slug)
                            setCopied(true)
                            showToast('Code copied!')
                            setTimeout(() => setCopied(false), 2000)
                          } catch {
                            showToast('Failed to copy', 'error')
                          }
                        }}
                      >
                        {copied ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={async () => {
                          const shareData = {
                            title: `Join ${activeEvent.name} on SnapRooms`,
                            text: `Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`,
                          }

                          if (navigator.share) {
                            try {
                              await navigator.share(shareData)
                              showToast('Shared!')
                            } catch {
                              // user cancelled
                            }
                          } else {
                            try {
                              await navigator.clipboard.writeText(
                                `Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`,
                              )
                              showToast('Invite copied!')
                            } catch {
                              showToast('Failed to copy', 'error')
                            }
                          }
                        }}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        onClick={() => setQrModalOpen(true)}
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Show QR
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      <span>Open for uploads</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <ImagePlus className="h-4 w-4" />
                      <span>{galleryPhotos.length} photos</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!saveEmailDismissed && (
              <SaveEventCard
                event={activeEvent}
                onDismiss={() => setSaveEmailDismissed(true)}
                onClaim={handleClaimRoom}
              />
            )}

            {!activeEvent?.ownerEmail && saveEmailDismissed && (
              <ClaimRoomCard event={activeEvent} onClaim={handleClaimRoom} />
            )}

            {isOwner && (
              <RoomManagementCard
                event={activeEvent}
                managementToken={managementToken}
                onEventUpdated={handleEventUpdated}
                onEventDeleted={handleEventDeleted}
                showToast={showToast}
              />
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">Add your photos</CardTitle>
                  <CardDescription>
                    Upload photos from your phone in seconds.
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Your name (optional)</label>
                    <Input
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder="Your name"
                    />
                  </div>

                  <label
                    className={`relative flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200 active:scale-[0.98] ${
                      activeEvent?.slug
                        ? 'border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10'
                        : 'cursor-not-allowed border-border bg-muted/30'
                    }`}
                  >
                    <input
                      accept="image/*"
                      capture="environment"
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      disabled={!activeEvent?.slug}
                      multiple
                      onChange={onFilesSelected}
                      type="file"
                      aria-label="Upload photos"
                    />
                    <div className="rounded-full bg-primary p-4 text-primary-foreground">
                      <ImagePlus className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-base font-medium">Tap to upload</p>
                      <p className="text-sm text-muted-foreground">
                        Choose photos or take a picture
                      </p>
                    </div>
                  </label>

                  {uploads.length > 0 && (
                    <div className="space-y-2">
                      {uploads.map((upload) => (
                        <div
                          key={upload.id}
                          className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{upload.name}</p>
                            <p className="text-xs text-muted-foreground">{upload.status}</p>
                          </div>
                          {upload.progress === 100 ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <Clock3 className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Room photos
                    <Badge variant="secondary" className="ml-2">
                      {galleryPhotos.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Tap any photo to view and download in full quality.
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <PhotoGalleryGrid
                    photos={galleryPhotos}
                    loading={galleryLoading}
                    error={galleryError}
                    onRetry={() => activeEvent?.slug && loadEvent(activeEvent.slug)}
                    onSelectPhoto={openLightbox}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      )}

      <EventQRModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        event={activeEvent}
        baseUrl={baseUrl}
      />

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={galleryPhotos}
        selectedIndex={lightboxIndex}
      />

      <ToastComponent />
    </main>
  )
}
