'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  FolderPlus,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Shield,
  Sparkles,
  Users,
} from 'lucide-react'
import PhotoGalleryGrid from '@/components/photo-gallery-grid'
import PhotoLightbox from '@/components/photo-lightbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

const CHUNK_SIZE = 1024 * 1024

const formatBytes = (value = 0) => {
  if (!value) {
    return '0 MB'
  }

  const megabytes = value / (1024 * 1024)
  return `${megabytes.toFixed(megabytes > 10 ? 0 : 1)} MB`
}

const LoadingDot = () => {
  return <Loader2 className="h-4 w-4 animate-spin" />
}

function App() {
  const [eventName, setEventName] = useState('Emma & Leo Wedding')
  const [eventLookup, setEventLookup] = useState('')
  const [guestName, setGuestName] = useState('')
  const [activeEvent, setActiveEvent] = useState(null)
  const [events, setEvents] = useState([])
  const [uploads, setUploads] = useState([])
  const [message, setMessage] = useState('Create an event or open one by code, then start sharing photos.')
  const [busy, setBusy] = useState({ create: false, join: false, refresh: false })
  const [recentEventsLoading, setRecentEventsLoading] = useState(true)
  const [recentEventsError, setRecentEventsError] = useState('')
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryError, setGalleryError] = useState('')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const galleryPhotos = useMemo(() => {
    return [...(activeEvent?.photos || [])].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
  }, [activeEvent])

  const repositoryModeLabel = useMemo(() => {
    return activeEvent ? `Live event: ${activeEvent.slug}` : 'Local MVP mode'
  }, [activeEvent])

  const loadEvents = async ({ background = false } = {}) => {
    if (!background) {
      setRecentEventsLoading(true)
    }

    setRecentEventsError('')

    try {
      const response = await fetch('/api/events', { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load recent events')
      }

      setEvents(payload.events || [])
    } catch (error) {
      setRecentEventsError(error.message || 'Unable to load recent events')
    } finally {
      if (!background) {
        setRecentEventsLoading(false)
      }
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

      if (!silent) {
        setMessage(`Opened ${payload.event.name}. The gallery refreshes every 3 seconds.`)
      }
    } catch (error) {
      setGalleryError(error.message || 'Unable to load gallery')

      if (!silent) {
        setMessage(error.message || 'Unable to open gallery')
      }
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
      setMessage(`Event ready. Share code ${payload.event.slug} and start uploading.`)
      await loadEvents({ background: true })
    } catch (error) {
      setMessage(error.message || 'Unable to create event')
    } finally {
      setBusy((current) => ({ ...current, create: false }))
    }
  }

  const uploadSingleFile = async (file) => {
    if (!activeEvent?.slug) {
      setMessage('Open an event before uploading photos.')
      return
    }

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

        updateUpload({ progress: 100, status: 'Shared with the gallery' })
        setActiveEvent(completePayload.event)
        setGalleryError('')
        setMessage(`Uploaded ${file.name}. Everyone in this event sees the newest photo at the top.`)
        await loadEvents({ background: true })
        return
      }

      updateUpload({ progress: 8, status: 'Uploading chunks' })

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

      updateUpload({ progress: 100, status: 'Shared with the gallery' })
      setActiveEvent(completePayload.event)
      setGalleryError('')
      setMessage(`Uploaded ${file.name}. Everyone in this event sees the newest photo at the top.`)
      await loadEvents({ background: true })
    } catch (error) {
      console.error('Upload failed', error)
      updateUpload({ status: error.message || 'Upload failed' })
      setMessage(error.message || 'Upload failed')
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

  useEffect(() => {
    loadEvents()
  }, [])

  useEffect(() => {
    if (!activeEvent?.slug) {
      return undefined
    }

    const interval = window.setInterval(() => {
      loadEvent(activeEvent.slug, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
  }, [activeEvent?.slug])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="border-b border-border bg-gradient-to-b from-background via-background to-muted/40">
        <div className="container px-4 py-8 sm:py-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-3 py-1 text-xs">Mobile-first MVP</Badge>
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">Chunked photo upload</Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">{repositoryModeLabel}</Badge>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
              <div className="space-y-5">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Camera className="h-6 w-6" />
                </div>
                <div className="space-y-3">
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                    Shared event galleries that guests can use in seconds.
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Create one event code, let guests upload straight from their phones, and watch the gallery fill up in near real time.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <FolderPlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Create an event</p>
                    <p className="mt-1 text-xs text-muted-foreground">One code. No setup friction.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Upload in chunks</p>
                    <p className="mt-1 text-xs text-muted-foreground">Safer on mobile connections.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Users className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Live shared gallery</p>
                    <p className="mt-1 text-xs text-muted-foreground">Newest photos appear first.</p>
                  </div>
                </div>
              </div>

              <Card className="border-border/80 shadow-xl shadow-primary/5">
                <CardHeader>
                  <CardTitle className="text-xl">Start with a live event</CardTitle>
                  <CardDescription>{message}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Event name</label>
                    <Input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="Emma & Leo Wedding" />
                    <Button className="w-full" onClick={createEvent} disabled={busy.create}>
                      {busy.create ? <LoadingDot /> : <Sparkles className="mr-2 h-4 w-4" />}
                      Create event
                    </Button>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-dashed border-border p-4">
                    <label className="text-sm font-medium">Already have an event code?</label>
                    <div className="flex gap-2">
                      <Input value={eventLookup} onChange={(event) => setEventLookup(event.target.value.toLowerCase())} placeholder="Enter event code" />
                      <Button variant="secondary" onClick={() => loadEvent(eventLookup)} disabled={busy.join || !eventLookup.trim()}>
                        {busy.join ? <LoadingDot /> : 'Open'}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" className="rounded-full">
                      <a href="/admin">
                        <Shield className="mr-2 h-4 w-4" />
                        Open admin panel
                      </a>
                    </Button>
                    {activeEvent?.slug ? <Badge variant="secondary" className="rounded-full">Share code: {activeEvent.slug}</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section className="container grid gap-6 px-4 py-8 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-border/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ImagePlus className="h-5 w-5 text-primary" />
              Upload pipeline
            </CardTitle>
            <CardDescription>
              Optimized for phones: choose photos, send them in 1 MB chunks, then publish them into the shared gallery.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Guest name (optional)</label>
              <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Jane" />
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-4">
              <label className="mb-2 block text-sm font-medium">Photo picker</label>
              <input
                accept="image/*"
                capture="environment"
                className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
                disabled={!activeEvent?.slug}
                multiple
                onChange={onFilesSelected}
                type="file"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {activeEvent?.slug ? `Uploading into ${activeEvent.slug}` : 'Create or open an event to enable uploads.'}
              </p>
            </div>

            <div className="space-y-3">
              {uploads.length === 0 ? (
                <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                  No uploads yet. Add photos to see chunk progress here.
                </div>
              ) : (
                uploads.map((upload) => (
                  <div key={upload.id} className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{upload.name}</p>
                        <p className="text-xs text-muted-foreground">{formatBytes(upload.size)} • {upload.status}</p>
                      </div>
                      {upload.progress === 100 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <Progress value={upload.progress} className="h-2" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Shared gallery</CardTitle>
                <CardDescription>
                  Loading, empty, and error states are optimized for a simple mobile-first event experience.
                </CardDescription>
              </div>
              {activeEvent?.slug ? (
                <Button variant="secondary" size="sm" onClick={() => loadEvent(activeEvent.slug)}>
                  <RefreshCcw className={`mr-2 h-4 w-4 ${busy.refresh ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeEvent ? (
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{activeEvent.name}</p>
                    <p className="text-sm text-muted-foreground">Share code: {activeEvent.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-full">{galleryPhotos.length} photos</Badge>
                    {busy.refresh ? <Badge variant="outline" className="rounded-full">Refreshing…</Badge> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {galleryError && activeEvent ? (
              <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium">Gallery refresh issue</p>
                  <p>{galleryError}</p>
                </div>
              </div>
            ) : null}

            <PhotoGalleryGrid
              emptyDescription="Open an event, upload from your camera roll, and the photos will land here in newest-first order."
              error={galleryError && !activeEvent ? galleryError : ''}
              loading={galleryLoading}
              onRetry={activeEvent?.slug ? () => loadEvent(activeEvent.slug) : undefined}
              onSelectPhoto={openLightbox}
              photos={galleryPhotos}
            />
          </CardContent>
        </Card>
      </section>

      <section className="container px-4 pb-10">
        <Card className="border-border/80 bg-muted/20">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Recent events</p>
                <p className="text-xs text-muted-foreground">Quick jump back into a gallery during MVP testing.</p>
              </div>
              {recentEventsLoading ? <Badge variant="outline">Loading…</Badge> : <Badge variant="secondary">{events.length} events</Badge>}
            </div>

            {recentEventsError ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {recentEventsError}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {recentEventsLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="h-10 w-28 animate-pulse rounded-full bg-muted" />
                ))
              ) : events.length === 0 ? (
                <Badge variant="outline">No events yet</Badge>
              ) : (
                events.map((event) => (
                  <Button key={event.id} variant="outline" className="rounded-full" onClick={() => loadEvent(event.slug)}>
                    {event.slug}
                  </Button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={galleryPhotos}
        selectedIndex={lightboxIndex}
      />
    </main>
  )
}

export default App
