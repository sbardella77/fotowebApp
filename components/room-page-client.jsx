'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  ImagePlus,
  LayoutDashboard,
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
import { getSortedRenderablePhotos } from '@/lib/photo-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'


const CHUNK_SIZE = 1024 * 1024

const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

function isSupportedImageFile(file) {
  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return true
  }
  // Fallback for browsers that report an empty type (e.g. some iOS HEIC uploads)
  const name = file.name?.toLowerCase() || ''
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

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
        className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all font-body ${
          toast.type === 'success'
            ? 'bg-white text-[#080C14]'
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
    try {
      const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`
      window.open(url, '_blank')
    } catch (e) {
      console.warn('[room] failed to open WhatsApp', e)
    }
  }

  const openTelegram = () => {
    try {
      const url = `https://t.me/share/url?url=${encodeURIComponent(eventUrl)}&text=${encodeURIComponent(`📸 Photos from ${event.name}`)}`
      window.open(url, '_blank')
    } catch (e) {
      console.warn('[room] failed to open Telegram', e)
    }
  }

  const copyLink = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(eventUrl)
        showToast('Link copied!')
      } else {
        showToast('Copy not supported on this device', 'error')
      }
    } catch {
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold text-white">Your room is ready!</p>
            <p className="mt-1 text-sm font-light text-muted-foreground">
              Invite guests to start sharing photos.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
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
            className="gap-1.5 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
            onClick={copyLink}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
            onClick={onShowQR}
          >
            <QrCode className="h-3.5 w-3.5" />
            QR code
          </Button>
        </div>
      </div>
    </div>
  )
}

function RoomNotFound() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Camera className="h-6 w-6" />
      </div>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">Room not found</h1>
        <p className="mt-2 text-sm font-light text-muted-foreground">
          The room you&apos;re looking for doesn&apos;t exist or may have been removed.
        </p>
        <p className="mt-1 text-sm font-light text-muted-foreground">
          Check the link or ask the organizer to share it again.
        </p>
      </div>
      <Button asChild className="glow-blue">
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
  const [uploadFormatError, setUploadFormatError] = useState('')
  const [showViralSection, setShowViralSection] = useState(false)
  const [newRoomBannerDismissed, setNewRoomBannerDismissed] = useState(false)
  const [showStickyCta, setShowStickyCta] = useState(false)
  const [lastUploadCount, setLastUploadCount] = useState(0)
  const [ownerSession, setOwnerSession] = useState({ authenticated: false, email: null })
  const heroFileInputRef = useRef(null)
  const cameraFileInputRef = useRef(null)
  const heroRef = useRef(null)
  const { showToast, ToastComponent } = useToast()

  useEffect(() => {
    fetch('/api/owner/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setOwnerSession(data))
      .catch(() => setOwnerSession({ authenticated: false, email: null }))
  }, [])

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  const galleryPhotos = useMemo(() => {
    try {
      return getSortedRenderablePhotos(activeEvent?.photos)
    } catch (pipelineError) {
      console.error('[room] photo pipeline crashed, returning empty', { slug: activeEvent?.slug, error: pipelineError })
      return []
    }
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
    setUploadSuccess(false)
    setUploadFormatError('')
    setShowViralSection(false)

    const supportedFiles = []
    const unsupportedFiles = []

    for (const file of fileList) {
      if (isSupportedImageFile(file)) {
        supportedFiles.push(file)
      } else {
        unsupportedFiles.push(file)
      }
    }

    if (unsupportedFiles.length > 0) {
      setUploadFormatError(
        unsupportedFiles.length === 1
          ? 'This image format isn\'t supported yet. Please upload JPG, PNG, WebP, or GIF.'
          : 'Some image formats aren\'t supported yet. Please upload JPG, PNG, WebP, or GIF.'
      )
    }

    if (supportedFiles.length === 0) {
      return
    }

    setIsUploading(true)
    setLastUploadCount(supportedFiles.length)

    for (const file of supportedFiles) {
      await uploadSingleFile(file)
    }

    setIsUploading(false)
    setUploadSuccess(true)
    setShowViralSection(true)
    showToast(supportedFiles.length === 1 ? 'Your photo is now in the room' : 'Your photos are now in the room')

    if (heroFileInputRef.current) heroFileInputRef.current.value = ''
    if (cameraFileInputRef.current) cameraFileInputRef.current.value = ''
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
      try {
        const url = new URL(window.location.href)
        if (url.searchParams.has('new')) {
          url.searchParams.delete('new')
          window.history.replaceState({}, '', url.toString())
        }
      } catch (e) {
        console.warn('[room] failed to clean URL', e)
      }
    }
  }, [isNew])

  useEffect(() => {
    if (!heroRef.current || typeof window === 'undefined') return
    let observer
    try {
      observer = new IntersectionObserver(
        ([entry]) => {
          setShowStickyCta(!entry.isIntersecting)
        },
        { threshold: 0, rootMargin: '0px' }
      )
      observer.observe(heroRef.current)
    } catch (e) {
      console.warn('[room] IntersectionObserver not available', e)
    }
    return () => {
      try {
        observer && observer.disconnect()
      } catch {
        // ignore
      }
    }
  }, [activeEvent?.slug])

  if (notFound) {
    return (
      <main className="dark min-h-screen bg-background font-body text-foreground">
        <header className="border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
          <div className="container flex h-14 items-center justify-between px-4">
            <a href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Camera className="h-4 w-4" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
            </a>
            {ownerSession?.authenticated && (
              <a
                href="/dashboard"
                className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Dashboard
              </a>
            )}
          </div>
        </header>
        <RoomNotFound />
      </main>
    )
  }

  return (
    <main className="dark relative min-h-screen bg-background font-body text-foreground">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />

      <header className="relative z-10 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>
          {ownerSession?.authenticated && (
            <a
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </a>
          )}
        </div>
      </header>

      {busy.join && !activeEvent ? (
        <div className="relative z-10 flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 px-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Camera className="h-6 w-6" />
          </div>
          <p className="text-lg font-light text-foreground">Opening your room...</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <section className="container relative z-10 px-4 py-8 pb-16">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Room info card */}
            <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-primary">
                      Room
                    </span>
                    <h1 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
                      {activeEvent.name}
                    </h1>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => loadEvent(activeEvent.slug, { silent: true })}
                  >
                    <RefreshCcw className={`h-4 w-4 ${busy.refresh ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm font-light text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" />
                    <span>Open for uploads</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <ImagePlus className="h-4 w-4 text-primary" />
                    <span>{galleryPhotos.length} photos</span>
                  </div>
                </div>

                {/* Room code + share actions */}
                <div className="mt-5 rounded-xl border border-white/[0.07] bg-[#0D1220] p-4 text-center">
                  <p className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Room code
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    {activeEvent.slug}
                  </p>
                  <p className="mt-1 text-xs font-light text-muted-foreground">
                    Share this code so guests can join
                  </p>

                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-white/[0.07] bg-[#111827] hover:bg-[#0D1220] hover:text-foreground"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(activeEvent.slug)
                            setCopied(true)
                            showToast('Code copied!')
                            setTimeout(() => setCopied(false), 2000)
                          } else {
                            showToast('Copy not supported on this device', 'error')
                          }
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
                      className="gap-1.5 border-white/[0.07] bg-[#111827] hover:bg-[#0D1220] hover:text-foreground"
                      onClick={async () => {
                        const shareData = {
                          title: `Join ${activeEvent.name} on SnapRooms`,
                          text: `Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`,
                        }

                        if (typeof navigator !== 'undefined' && navigator.share) {
                          try {
                            await navigator.share(shareData)
                            showToast('Shared!')
                          } catch {
                            // user cancelled
                          }
                        } else {
                          try {
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(
                                `Upload your photos to ${activeEvent.name}! Use code: ${activeEvent.slug}`,
                              )
                              showToast('Invite copied!')
                            } else {
                              showToast('Share not supported on this device', 'error')
                            }
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
                      className="gap-1.5 border-white/[0.07] bg-[#111827] hover:bg-[#0D1220] hover:text-foreground"
                      onClick={() => setQrModalOpen(true)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      Show QR
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload hero */}
            <div ref={heroRef} className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card overflow-hidden">
              <div className="p-6 text-center sm:p-8">
                <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  Add your photos
                </h2>
                <p className="mt-2 text-base font-light text-muted-foreground">
                  Be part of {activeEvent.name}
                </p>

                <p className="mt-2 font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  {galleryPhotos.length > 0
                    ? `${galleryPhotos.length} photos shared`
                    : 'Be the first to add a photo'}
                </p>

                <div className="mt-5 mx-auto max-w-sm">
                  <div className="space-y-2 text-left">
                    <label className="text-sm font-medium text-foreground">Your name (optional)</label>
                    <Input
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      placeholder="Your name"
                      className="h-11 rounded-lg border-white/[0.07] bg-[#0D1220] text-foreground placeholder:text-muted-foreground focus:border-[rgba(99,179,255,0.25)] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>

                {uploadSuccess && (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {lastUploadCount === 1
                      ? 'Your photo is now in the room'
                      : 'Your photos are now in the room'}
                  </div>
                )}

                {uploadFormatError && (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-5 py-3 text-sm font-medium text-red-400">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {uploadFormatError}
                  </div>
                )}

                {isUploading ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#0D1220] px-5 py-3 text-sm font-medium text-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Uploading {uploads.filter((u) => u.progress < 100).length} photos...
                  </div>
                ) : (
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button
                      size="lg"
                      className="h-12 gap-2 rounded-lg px-6 text-base font-body font-medium glow-blue"
                      onClick={() => {
                        setUploadSuccess(false)
                        setUploadFormatError('')
                        cameraFileInputRef.current?.click()
                      }}
                    >
                      <Camera className="h-5 w-5" />
                      Snap your photo
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-12 gap-2 rounded-lg px-6 text-base font-body font-medium border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
                      onClick={() => {
                        setUploadSuccess(false)
                        setUploadFormatError('')
                        heroFileInputRef.current?.click()
                      }}
                    >
                      <Upload className="h-5 w-5" />
                      Upload your photo
                    </Button>
                  </div>
                )}

                <p className="mt-4 text-xs font-light text-muted-foreground">
                  No app. No signup. Works instantly on any phone.
                </p>
              </div>
            </div>

            <input
              ref={heroFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={onFilesSelected}
            />
            <input
              ref={cameraFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              capture="environment"
              className="hidden"
              onChange={onFilesSelected}
            />

            {/* Viral share section */}
            {showViralSection && (
              <div className="mt-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06]">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-base font-bold text-white">Invite others to share</p>
                      <p className="mt-1 text-sm font-light text-muted-foreground">
                        The more people share, the better the memories.
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
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
                        try {
                          const eventUrl = `${baseUrl}/event/${activeEvent.slug}`
                          const message = `📸 Photos from ${activeEvent.name}\n\nAdd yours here 👇\n${eventUrl}`
                          const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`
                          window.open(whatsappUrl, '_blank')
                        } catch (e) {
                          console.warn('[room] failed to open WhatsApp', e)
                        }
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
                      className="gap-1.5 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
                      onClick={async () => {
                        try {
                          if (navigator.clipboard && navigator.clipboard.writeText) {
                            await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`)
                            showToast('Link copied!')
                          } else {
                            showToast('Copy not supported on this device', 'error')
                          }
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
                      className="gap-1.5 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
                      onClick={async () => {
                        const shareData = {
                          title: `Join ${activeEvent.name} on SnapRooms`,
                          text: `Upload your photos to ${activeEvent.name}!`,
                          url: `${baseUrl}/event/${activeEvent.slug}`,
                        }
                        if (typeof navigator !== 'undefined' && navigator.share) {
                          try {
                            await navigator.share(shareData)
                            showToast('Shared!')
                          } catch {
                            // user cancelled
                          }
                        } else {
                          try {
                            if (navigator.clipboard && navigator.clipboard.writeText) {
                              await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`)
                              showToast('Link copied!')
                            } else {
                              showToast('Share not supported on this device', 'error')
                            }
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
                      className="gap-1.5 border-white/[0.07] bg-[#0D1220] hover:bg-[#111827] hover:text-foreground"
                      onClick={() => setQrModalOpen(true)}
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      QR code
                    </Button>
                  </div>
                </div>
              </div>
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

            {uploads.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploads.map((upload) => (
                  <div
                    key={upload.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-[#141C2E] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{upload.name}</p>
                      <p className="text-xs font-light text-muted-foreground">{upload.status}</p>
                    </div>
                    {upload.progress === 100 ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Clock3 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Gallery */}
            <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
              <div className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                    Room photos
                  </span>
                  <Badge variant="secondary" className="rounded-full font-mono text-[0.6rem] bg-[#111827] text-muted-foreground border-white/[0.07]">
                    {galleryPhotos.length}
                  </Badge>
                </div>
                <p className="mt-1 text-sm font-light text-muted-foreground">
                  Tap any photo to view and download in full quality.
                </p>

                <div className="mt-5">
                  <PhotoGalleryGrid
                    photos={galleryPhotos}
                    loading={galleryLoading}
                    error={galleryError}
                    onRetry={() => activeEvent?.slug && loadEvent(activeEvent.slug)}
                    onSelectPhoto={openLightbox}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div
        className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 transition-opacity duration-200 sm:hidden ${
          showStickyCta ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <Button
          size="sm"
          className="h-11 gap-2 rounded-full px-6 text-sm font-body font-medium glow-blue"
          onClick={() => {
            setUploadSuccess(false)
            setUploadFormatError('')
            cameraFileInputRef.current?.click()
          }}
        >
          <Camera className="h-4 w-4" />
          Snap photo
        </Button>
      </div>

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
