'use client'

import { useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, Clock3, FolderPlus, ImagePlus, Loader2, Sparkles, Users } from 'lucide-react'
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
  const [message, setMessage] = useState('Create an event or open one by code, then start dropping photos.')
  const [busy, setBusy] = useState({ create: false, join: false, refresh: false })

  const galleryPhotos = activeEvent?.photos || []

  const repositoryModeLabel = useMemo(() => {
    return activeEvent ? `Live event: ${activeEvent.slug}` : 'Local MVP mode'
  }, [activeEvent])

  const loadEvents = async () => {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' })
      const payload = await response.json()

      if (response.ok) {
        setEvents(payload.events || [])
      }
    } catch (error) {
      console.error('Failed to load events', error)
    }
  }

  const loadEvent = async (slug, { silent = false } = {}) => {
    if (!slug) {
      return
    }

    if (!silent) {
      setBusy((current) => ({ ...current, join: true }))
    }

    try {
      const response = await fetch(`/api/events/${slug}`, { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to open gallery')
      }

      setActiveEvent(payload.event)
      setEventLookup(payload.event.slug)
      setMessage(`Opened ${payload.event.name}. Gallery auto-refreshes every 3 seconds.`)
    } catch (error) {
      setMessage(error.message)
    } finally {
      if (!silent) {
        setBusy((current) => ({ ...current, join: false }))
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
      setMessage(`Event ready. Share code ${payload.event.slug} and start uploading.`)
      await loadEvents()
    } catch (error) {
      setMessage(error.message)
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
      setMessage(`Uploaded ${file.name}. Everyone in this event sees the new photo on refresh.`)
      await loadEvents()
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
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full px-3 py-1 text-xs">Mobile-first MVP</Badge>
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">Chunked photo upload</Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">{repositoryModeLabel}</Badge>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
              <div className="space-y-4">
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
                    <p className="mt-1 text-xs text-muted-foreground">Safer for mobile networks.</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                    <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Users className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Shared gallery</p>
                    <p className="mt-1 text-xs text-muted-foreground">Auto-refresh every 3 seconds.</p>
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
              Optimized for phones: choose photos, send them in 1 MB chunks, then publish them into the event gallery.
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
            <CardTitle className="text-lg">Shared gallery</CardTitle>
            <CardDescription>
              Latest uploads appear here. Polling refresh keeps the shared wall feeling live without overengineering the MVP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeEvent ? (
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{activeEvent.name}</p>
                    <p className="text-sm text-muted-foreground">Share code: {activeEvent.slug}</p>
                  </div>
                  <Badge variant="secondary">{galleryPhotos.length} photos</Badge>
                </div>
              </div>
            ) : null}

            {galleryPhotos.length === 0 ? (
              <div className="grid min-h-[300px] place-items-center rounded-3xl border border-dashed border-border bg-muted/20 p-6 text-center">
                <div className="space-y-2">
                  <p className="text-base font-medium">Your first gallery is one upload away.</p>
                  <p className="text-sm text-muted-foreground">Open an event, upload from your camera roll, and the photos will land here.</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {galleryPhotos.map((photo) => (
                  <div key={photo.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <img alt={photo.originalName} className="aspect-square h-full w-full object-cover" src={photo.url} />
                    <div className="space-y-1 p-3">
                      <p className="truncate text-sm font-medium">{photo.originalName}</p>
                      <p className="text-xs text-muted-foreground">{photo.uploaderName || 'Guest upload'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="container px-4 pb-10">
        <Card className="border-border/80 bg-muted/20">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Recent events</p>
              <p className="text-xs text-muted-foreground">Quick jump back into a gallery during MVP testing.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {events.length === 0 ? (
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
    </main>
  )
}

export default App
