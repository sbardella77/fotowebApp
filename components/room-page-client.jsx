'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCcw,
  Share2,
  Upload,
  Users,
  X,
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

function NewRoomShareBanner({ event, baseUrl, onDismiss, showToast, onShowQR }) {
  const eventUrl = `${baseUrl}/event/${event.slug}`

  const shareText = `📸 Photos from ${event.name}\n\nAdd yours here 👇\n${eventUrl}`

  const openWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`
    window.open(url, '_blank')
  }

  const openTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(eventUrl)}&text=${encodeURIComponent(`📸 Photos from ${event.name}`)}`
    window.open(url, '_blank')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl)
      showToast('Link copied!')
    } catch {
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <Card className="mt-6 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">Your room is ready!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Invite guests to start sharing photos.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button
            size="sm"
            className="gap-1.5 bg-[#25D366] text-white hover:bg-[#128C7E] border-transparent"
            onClick={openWhatsApp}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            WhatsApp
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-[#0088cc] text-white hover:bg-[#0077b3] border-transparent"
            onClick={openTelegram}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Telegram
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 bg-background"
            onClick={copyLink}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 bg-background"
            onClick={onShowQR}
          >
            <QrCode className="h-3.5 w-3.5" />
            QR code
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

export default function RoomPageClient({ slug, isNew }) {
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
  const [notFound, setNotFound] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [showViralSection, setShowViralSection] = useState(false)
  const [newRoomBannerDismissed, setNewRoomBannerDismissed] = useState(false)
  const heroFileInputRef = useRef(null)
  const cameraFileInputRef = useRef(null)
  const { showToast, ToastComponent } = useToast()

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const galleryPhotos = useMemo(() => {
    return [...(activeEvent?.photos || [])].sort(
      (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
    )
  }, [activeEvent])

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
    const input = event.target
    if (fileList.length === 0) return

    input.value = ''
    setIsUploading(true)
    setUploadSuccess(false)
    setShowViralSection(false)

    for (const file of fileList) {
      await uploadSingleFile(file)
    }

    setIsUploading(false)
    setUploadSuccess(true)
    setShowViralSection(true)
    showToast('Your photos are now in the room')
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

    const interval = window.setInterval(() => {
      loadEvent(activeEvent.slug, { silent: true })
    }, 3000)

    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug])

  useEffect(() => {
    if (isNew && typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      if (url.searchParams.has('new')) {
        url.searchParams.delete('new')
        window.history.replaceState({}, '', url.toString())
      }
    }
  }, [isNew])

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
          </div>
        </header>
        <RoomNotFound />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center px-4">
          <div className="flex items-center gap-2">
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="h-8 w-8 rounded-md object-cover"
            />
            <span className="font-semibold tracking-tight">SnapRooms</span>
          </div>
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

            {/* Upload-first hero */}
            <Card className="mt-6 overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
              <CardContent className="p-6 text-center sm:p-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Add your photos to this room
                </h2>
                <p className="mt-2 text-base text-muted-foreground">
                  Be part of {activeEvent.name}
                </p>

                <p className="mt-2 text-sm font-medium text-primary">
                  {galleryPhotos.length > 0
                    ? `${galleryPhotos.length} photos already shared`
                    : 'Be one of the first to share'}
                </p>

                {isUploading ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-background px-5 py-3 text-sm font-medium shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Uploading {uploads.filter((u) => u.progress < 100).length} photos...
                  </div>
                ) : uploadSuccess ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-green-50 px-5 py-3 text-sm font-medium text-green-700 shadow-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Your photos are now in the room
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button
                      size="lg"
                      className="gap-2 rounded-full px-6 text-base"
                      onClick={() => heroFileInputRef.current?.click()}
                    >
                      <Upload className="h-5 w-5" />
                      Upload your photos
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="gap-2 rounded-full px-6 text-base"
                      onClick={() => cameraFileInputRef.current?.click()}
                    >
                      <Camera className="h-5 w-5" />
                      Snap a photo
                    </Button>
                  </div>
                )}

                <p className="mt-3 text-xs text-muted-foreground">No app. No signup.</p>
              </CardContent>
            </Card>

            <input
              ref={heroFileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onFilesSelected}
            />
            <input
              ref={cameraFileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onFilesSelected}
            />

            {/* Viral share section */}
            {showViralSection && (
              <Card className="mt-4 border-green-200 bg-green-50/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">Invite others to share their photos</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The more people share, the better the memories.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0"
                      onClick={() => setShowViralSection(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-[#25D366] text-white hover:bg-[#128C7E] border-transparent"
                      onClick={() => {
                        const eventUrl = `${baseUrl}/event/${activeEvent.slug}`
                        const message = `📸 Photos from ${activeEvent.name}\n\nAdd yours here 👇\n${eventUrl}`
                        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`
                        window.open(whatsappUrl, '_blank')
                      }}
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      Share on WhatsApp
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 bg-background"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`)
                          showToast('Link copied!')
                        } catch {
                          showToast('Failed to copy', 'error')
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 bg-background"
                      onClick={async () => {
                        const shareData = {
                          title: `Join ${activeEvent.name} on SnapRooms`,
                          text: `Upload your photos to ${activeEvent.name}!`,
                          url: `${baseUrl}/event/${activeEvent.slug}`,
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
                            await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`)
                            showToast('Link copied!')
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
                      variant="outline"
                      className="gap-1.5 bg-background"
                      onClick={() => setQrModalOpen(true)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR code
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {isNew && !newRoomBannerDismissed && (
              <NewRoomShareBanner
                event={activeEvent}
                baseUrl={baseUrl}
                onDismiss={() => setNewRoomBannerDismissed(true)}
                showToast={showToast}
                onShowQR={() => setQrModalOpen(true)}
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
