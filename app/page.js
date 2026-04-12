'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCcw,
  Share2,
  Users,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import PhotoGalleryGrid from '@/components/photo-gallery-grid'
import PhotoLightbox from '@/components/photo-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const CHUNK_SIZE = 1024 * 1024

const LoadingDot = () => <Loader2 className="h-4 w-4 animate-spin" />

// Simple toast hook
const useToast = () => {
  const [toast, setToast] = useState(null)
  
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }
  
  const ToastComponent = () => {
    if (!toast) return null
    return (
      <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
        toast.type === 'success' ? 'bg-foreground text-background' : 'bg-destructive text-destructive-foreground'
      }`}>
        {toast.message}
      </div>
    )
  }
  
  return { showToast, ToastComponent }
}

function App() {
  const [eventName, setEventName] = useState('')
  const [eventLookup, setEventLookup] = useState('')
  const [guestName, setGuestName] = useState('')
  const [activeEvent, setActiveEvent] = useState(null)
  const [events, setEvents] = useState([])
  const [uploads, setUploads] = useState([])
  const [busy, setBusy] = useState({ create: false, join: false, refresh: false })
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryError, setGalleryError] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const { showToast, ToastComponent } = useToast()

  // Generate event URL for sharing
  const eventUrl = useMemo(() => {
    if (!activeEvent?.slug) return ''
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    return `${baseUrl}/?event=${activeEvent.slug}`
  }, [activeEvent?.slug])

  const galleryPhotos = useMemo(() => {
    return [...(activeEvent?.photos || [])].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
  }, [activeEvent])

  const loadEvents = async () => {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' })
      const payload = await response.json()
      if (response.ok) {
        setEvents(payload.events || [])
      }
    } catch {
      // Silently fail for background loading
    }
  }

  const loadEvent = async (slug, { silent = false } = {}) => {
    if (!slug) {
      return
    }

    setGalleryError('')

    if (silent) {
      setBusy((current) => ({ ...current, refresh: true }))
    } else {
      setBusy((current) => ({ ...current, join: true }))
      setGalleryLoading(true)
    }

    try {
      const response = await fetch(`/api/events/${slug}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to open gallery')
      }

      setActiveEvent(payload.event)
      setEventLookup(payload.event.slug)
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

  const createEvent = async () => {
    setBusy((current) => ({ ...current, create: true }))

    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: eventName }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to create event')
      }

      setActiveEvent({ ...payload.event, photos: [] })
      setEventLookup(payload.event.slug)
      setGalleryError('')
      setGalleryLoading(false)
      await loadEvents()
    } catch {
      // Error handled by UI state
    } finally {
      setBusy((current) => ({ ...current, create: false }))
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
          if (item.id !== localId) {
            return item
          }

          return {
            ...item,
            ...next,
          }
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
        await loadEvents()
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
        updateUpload({ progress: chunkProgress, status: `Uploaded ${chunkIndex + 1}/${totalChunks} chunks` })
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
      await loadEvents()
    } catch (error) {
      console.error('Upload failed', error)
      updateUpload({ status: 'Failed' })
    }
  }

  const onFilesSelected = async (event) => {
    const fileList = Array.from(event.target.files || [])

    if (fileList.length === 0) {
      return
    }

    for (const file of fileList) {
      await uploadSingleFile(file)
    }

    event.target.value = ''
  }

  const openLightbox = (index) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
  }

  // Initial load - check for event in URL
  useEffect(() => {
    loadEvents()
    
    // Check for event query parameter on load
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const eventSlug = params.get('event')
      if (eventSlug) {
        setEventLookup(eventSlug)
        // Small delay to ensure loadEvent is available
        setTimeout(() => {
          loadEvent(eventSlug)
        }, 0)
        // Clean up URL after loading
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresh active event
  useEffect(() => {
    if (!activeEvent?.slug) {
      return undefined
    }

    const interval = window.setInterval(() => {
      loadEvent(activeEvent.slug, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug])

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">Moment</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <a href="/admin">Admin</a>
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-background" />
        <div className="container relative px-4 py-10 sm:py-14">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Your guests are taking photos.<br />
              <span className="text-primary">Collect them all.</span>
            </h1>
            <p className="mt-3 text-base text-muted-foreground">
              Create an event, share the code, and gather every photo in one place. 
              No app needed — guests just tap and upload.
            </p>
          </div>
        </div>
      </section>

      {/* How it Works */}
      {!activeEvent && (
        <section className="container px-4 pb-8">
          <div className="mx-auto max-w-4xl">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col items-center rounded-xl border border-border/50 bg-card p-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <span className="text-sm font-bold">1</span>
                </div>
                <h3 className="mt-3 text-sm font-medium">Create event</h3>
                <p className="mt-1 text-xs text-muted-foreground">Name your event and get a unique code</p>
              </div>
              <div className="flex flex-col items-center rounded-xl border border-border/50 bg-card p-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <span className="text-sm font-bold">2</span>
                </div>
                <h3 className="mt-3 text-sm font-medium">Share the code</h3>
                <p className="mt-1 text-xs text-muted-foreground">Text or show the code to your guests</p>
              </div>
              <div className="flex flex-col items-center rounded-xl border border-border/50 bg-card p-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <span className="text-sm font-bold">3</span>
                </div>
                <h3 className="mt-3 text-sm font-medium">Collect photos</h3>
                <p className="mt-1 text-xs text-muted-foreground">Watch the gallery fill up in real-time</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content */}
      <section className="container px-4 pb-12">
        <div className="mx-auto max-w-4xl">
          {/* Event Setup Card */}
          <Card className="border-border/50 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold">
                {activeEvent ? activeEvent.name : 'Create your event'}
              </CardTitle>
              <CardDescription>
                {activeEvent 
                  ? `Share code: ${activeEvent.slug}` 
                  : 'Set up an event in seconds'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!activeEvent ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Event name</label>
                    <Input 
                      value={eventName} 
                      onChange={(event) => setEventName(event.target.value)} 
                      placeholder="Sarah & Mike's Wedding"
                    />
                    <Button className="w-full" onClick={createEvent} disabled={busy.create}>
                      {busy.create ? <LoadingDot /> : 'Create event'}
                    </Button>
                  </div>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Join an event</label>
                    <div className="flex gap-2">
                      <Input 
                        value={eventLookup} 
                        onChange={(event) => setEventLookup(event.target.value.toLowerCase())} 
                        placeholder="Enter event code"
                      />
                      <Button 
                        variant="secondary" 
                        onClick={() => loadEvent(eventLookup)} 
                        disabled={busy.join || !eventLookup.trim()}
                      >
                        {busy.join ? <LoadingDot /> : 'Join'}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  {/* Event Code - Visual Focal Point */}
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
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Event Code</p>
                    <p className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{activeEvent.slug}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Share this code with your guests</p>
                    
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
                        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="gap-1.5"
                        onClick={async () => {
                          const shareData = {
                            title: `Join ${activeEvent.name} on Moment`,
                            text: `Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`,
                          }
                          if (navigator.share) {
                            try {
                              await navigator.share(shareData)
                              showToast('Shared!')
                            } catch {
                              // User cancelled
                            }
                          } else {
                            try {
                              await navigator.clipboard.writeText(`Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`)
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
                  
                  {/* Quick Stats */}
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
              )}
            </CardContent>
          </Card>

          {/* Upload & Gallery Section */}
          {activeEvent && (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {/* Upload Card */}
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">Share your moments</CardTitle>
                  <CardDescription>
                    Your perspective matters — add your photos to the collection
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

                  <label className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200 active:scale-[0.98] ${
                    activeEvent?.slug 
                      ? 'border-primary/40 bg-primary/5 hover:border-primary/60 hover:bg-primary/10' 
                      : 'border-border bg-muted/30 cursor-not-allowed'
                  }`}>
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
                    <div className="rounded-full bg-primary p-3 text-primary-foreground">
                      <ImagePlus className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Tap to upload</p>
                      <p className="text-xs text-muted-foreground">Choose photos or take a picture</p>
                    </div>
                  </label>

                  {uploads.length > 0 && (
                    <div className="space-y-2">
                      {uploads.map((upload) => (
                        <div key={upload.id} className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                          <div className="flex-1 min-w-0">
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

              {/* Gallery Card */}
              <Card className="border-border/50">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Photo gallery
                    <Badge variant="secondary" className="ml-2">
                      {galleryPhotos.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Tap photos to view and download in full quality
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
          )}
        </div>
      </section>

      {/* Recent Events Footer */}
      {!activeEvent && events.length > 0 && (
        <section className="container px-4 pb-12">
          <div className="mx-auto max-w-4xl">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Recent events</p>
            <div className="flex flex-wrap gap-2">
              {events.slice(0, 6).map((event) => (
                <Button 
                  key={event.id} 
                  variant="outline" 
                  size="sm"
                  onClick={() => loadEvent(event.slug)}
                >
                  {event.name}
                </Button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* QR Code Modal */}
      {qrModalOpen && activeEvent && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setQrModalOpen(false)}
        >
          <div 
            className="relative w-full max-w-sm rounded-2xl bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setQrModalOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header */}
            <div className="mb-6 text-center">
              <h3 className="text-lg font-semibold">{activeEvent.name}</h3>
              <p className="text-sm text-muted-foreground">
                Scan to open this event
              </p>
            </div>

            {/* QR Code */}
            <div className="mb-6 flex justify-center">
              <div className="rounded-xl border-2 border-border bg-white p-4">
                <QRCodeSVG
                  value={eventUrl}
                  size={200}
                  level="M"
                  includeMargin={false}
                />
              </div>
            </div>

            {/* Helper text */}
            <p className="mb-4 text-center text-xs text-muted-foreground">
              Point your camera at this code to open the event instantly
            </p>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(eventUrl)
                    showToast('Link copied!')
                  } catch {
                    showToast('Failed to copy', 'error')
                  }
                }}
              >
                <Copy className="h-4 w-4" />
                Copy Link
              </Button>
              {/* Placeholder for future download functionality */}
              {/* <Button
                variant="secondary"
                className="flex-1 gap-1.5"
                onClick={() => {
                  // TODO: Implement QR download
                  // 1. Create canvas from QR code
                  // 2. Convert to blob/png
                  // 3. Trigger download
                  showToast('Download coming soon!')
                }}
              >
                <Download className="h-4 w-4" />
                Save QR
              </Button> */}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={galleryPhotos}
        selectedIndex={lightboxIndex}
      />
      
      {/* Toast Notifications */}
      <ToastComponent />
    </main>
  )
}

export default App
