'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
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
import { Input } from '@/components/ui/input'
import { trackEvent } from '@/lib/analytics/track-client'
import {
  EVENT_ROOM_VIEWED,
  EVENT_SNAP_CTA_CLICKED,
  EVENT_UPLOAD_CTA_CLICKED,
  EVENT_UPLOAD_STARTED,
  EVENT_UPLOAD_COMPLETED,
  EVENT_SECOND_UPLOAD_COMPLETED,
  EVENT_UPLOAD_FILE_REJECTED,
  EVENT_WHATSAPP_SHARE_CLICKED,
  EVENT_NATIVE_SHARE_CLICKED,
  EVENT_COPY_LINK_CLICKED,
  EVENT_QR_OPENED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED,
  EVENT_GALLERY_DOWNLOAD_CLICKED,
  EVENT_GALLERY_DOWNLOAD_COMPLETED,
  EVENT_GALLERY_DOWNLOAD_BLOCKED,
} from '@/lib/analytics/events'
import { useTranslations } from '@/components/i18n-provider'
import { LanguageSwitcher } from '@/components/language-switcher'
import { InstallCta } from '@/components/install-cta'

const CHUNK_SIZE = 1024 * 1024

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

function isSupportedImageFile(file) {
  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return true
  }
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
      <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium shadow-xl transition-all font-body ${
        toast.type === 'success' ? 'bg-surface text-foreground border border-border' : 'bg-destructive text-destructive-foreground'
      }`}>
        {toast.message}
      </div>
    )
  }
  return { showToast, ToastComponent }
}

function NewRoomShareBanner({ event, baseUrl, onDismiss, showToast, onShowQR }) {
  const t = useTranslations('room')
  const eventUrl = `${baseUrl}/event/${event.slug}`
  const shareText = `📸 ${event.name}\n\n${eventUrl}`

  const openWhatsApp = () => {
    trackEvent(EVENT_WHATSAPP_SHARE_CLICKED, { room_slug: event?.slug, source: 'new_room_banner' })
    try { window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank') } catch (e) { console.warn(e) }
  }
  const openTelegram = () => {
    try { window.open(`https://t.me/share/url?url=${encodeURIComponent(eventUrl)}&text=${encodeURIComponent(`📸 ${event.name}`)}`, '_blank') } catch (e) { console.warn(e) }
  }
  const copyLink = async () => {
    trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: event?.slug, source: 'new_room_banner' })
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(eventUrl)
        showToast(t.copied + '!')
      } else { showToast(t.copy + ' ' + t.error, 'error') }
    } catch { showToast(t.error, 'error') }
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface shadow-card">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-base font-bold text-foreground">{t.inviteOthers}</p>
            <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">{t.noAppNeeded}</p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button size="sm" className="gap-1.5 bg-[#25D366] text-foreground hover:bg-[#128C7E] border-transparent" onClick={openWhatsApp}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            {t.whatsapp}
          </Button>
          <Button size="sm" className="gap-1.5 bg-[#0088cc] text-foreground hover:bg-[#0077b3] border-transparent" onClick={openTelegram}>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            {t.telegram}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={copyLink}>
            <Copy className="h-3.5 w-3.5" />{t.copyLink}
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={onShowQR}>
            <QrCode className="h-3.5 w-3.5" />{t.showQR}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RoomNotFound() {
  const t = useTranslations('room')
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Camera className="h-7 w-7" />
      </div>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{t.roomNotFound}</h1>
        <p className="mt-2 text-sm font-light leading-relaxed text-muted-foreground">{t.roomNotFoundDesc}</p>
        <p className="mt-1 text-sm font-light text-muted-foreground">{t.roomNotFoundHelp}</p>
      </div>
      <Button asChild className="cta-primary">
        <a href="/">{t.backToHome}</a>
      </Button>
    </div>
  )
}

export default function RoomPageClient({ slug, isNew }) {
  const t = useTranslations('room')
  const tCommon = useTranslations('common')
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
  const [unlockMessage, setUnlockMessage] = useState('')
  const [photoLimitError, setPhotoLimitError] = useState(null)
  const heroFileInputRef = useRef(null)
  const cameraFileInputRef = useRef(null)
  const heroRef = useRef(null)
  const roomViewTracked = useRef(false)
  const uploadCompletedTracked = useRef(false)
  const { showToast, ToastComponent } = useToast()

  useEffect(() => {
    fetch('/api/owner/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setOwnerSession(data))
      .catch(() => setOwnerSession({ authenticated: false, email: null }))
  }, [])

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const unlock = params.get('unlock')
    if (unlock === 'success') {
      setUnlockMessage(t.originalQuality + ' ' + t.downloadAvailable)
      showToast(t.originalQuality + ' ' + t.downloadAvailable)
      if (activeEvent?.slug) { loadEvent(activeEvent.slug, { silent: true }) }
      try { const url = new URL(window.location.href); url.searchParams.delete('unlock'); window.history.replaceState({}, '', url.toString()) } catch (e) { console.warn(e) }
    } else if (unlock === 'cancelled') {
      setUnlockMessage(t.unlockCancelled)
      trackEvent(EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED, { room_slug: activeEvent?.slug, source: 'room_page' })
      try { const url = new URL(window.location.href); url.searchParams.delete('unlock'); window.history.replaceState({}, '', url.toString()) } catch (e) { console.warn(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug])

  const galleryPhotos = useMemo(() => {
    try { return getSortedRenderablePhotos(activeEvent?.photos) }
    catch (pipelineError) { console.error('[room] photo pipeline crashed', { slug: activeEvent?.slug, error: pipelineError }); return [] }
  }, [activeEvent])

  const isFreeEvent = useMemo(() => {
    return activeEvent && !activeEvent.billingTier && activeEvent.ownerPlan !== 'professional' && activeEvent.ownerPlan !== 'business'
  }, [activeEvent])

  const loadEvent = async (targetSlug, { silent = false } = {}) => {
    if (!targetSlug) return
    setGalleryError('')
    if (silent) { setBusy((current) => ({ ...current, refresh: true })) }
    else { setBusy((current) => ({ ...current, join: true })); setGalleryLoading(true) }
    try {
      const response = await fetch(`/api/events/${targetSlug}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        if (response.status === 404) { setNotFound(true) }
        throw new Error(payload.error || t.unableToOpenGallery)
      }
      setActiveEvent(payload.event)
      if (!roomViewTracked.current) {
        roomViewTracked.current = true
        trackEvent(EVENT_ROOM_VIEWED, {
          room_slug: payload.event?.slug, room_name: payload.event?.name,
          is_new_room: isNew, photo_count: payload.event?.photos?.length || 0,
        })
      }
    } catch (error) { setGalleryError(error.message || t.unableToLoadGallery) }
    finally {
      if (silent) { setBusy((current) => ({ ...current, refresh: false })) }
      else { setBusy((current) => ({ ...current, join: false })); setGalleryLoading(false) }
    }
  }

  const uploadSingleFile = async (file) => {
    if (!activeEvent?.slug) return false
    const localId = `${file.name}-${file.lastModified}`
    setUploads((current) => [{ id: localId, name: file.name, size: file.size, progress: 2, status: t.preparingUpload }, ...current])
    const updateUpload = (next) => { setUploads((current) => current.map((item) => item.id === localId ? { ...item, ...next } : item)) }
    try {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const initResponse = await fetch('/api/uploads/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug: activeEvent.slug, fileName: file.name, fileSize: file.size, mimeType: file.type || 'image/jpeg', totalChunks }),
      })
      const initPayload = await initResponse.json()
      if (!initResponse.ok) {
        if (initPayload.limit === 'photo_count') { setPhotoLimitError(initPayload); updateUpload({ status: t.roomPhotoLimitReached }); return false }
        throw new Error(initPayload.error || t.uploadError)
      }
      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        updateUpload({ progress: 8, status: t.uploading + ' ' + t.galleryTitle })
        const blob = await upload(initPayload.session.pathname || file.name, file, {
          access: 'public', handleUploadUrl: initPayload.session.handleUploadUrl || '/api/uploads/blob',
          clientPayload: JSON.stringify({ eventSlug: activeEvent.slug, fileName: file.name, fileSize: file.size, mimeType: file.type || 'image/jpeg' }),
          multipart: file.size > 5 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => { updateUpload({ progress: 10 + Math.round((percentage / 100) * 75), status: `${t.uploadedPercent} ${Math.round(percentage)}%` }) },
        })
        updateUpload({ progress: 90, status: t.finalizingGallery })
        const completeResponse = await fetch('/api/uploads/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventSlug: activeEvent.slug, blobUrl: blob.url, blobPathname: blob.pathname, originalName: file.name, mimeType: file.type || 'image/jpeg', size: file.size, uploaderName: guestName, caption: '' }),
        })
        const completePayload = await completeResponse.json()
        if (!completeResponse.ok) {
          if (completePayload.limit === 'photo_count') { setPhotoLimitError(completePayload); updateUpload({ status: t.roomPhotoLimitReached }); return false }
          throw new Error(completePayload.error || t.uploadError)
        }
        updateUpload({ progress: 100, status: tCommon.done })
        setActiveEvent(completePayload.event); setGalleryError(''); return true
      }
      updateUpload({ progress: 8, status: t.uploading })
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * CHUNK_SIZE; const end = Math.min(start + CHUNK_SIZE, file.size); const chunkBlob = file.slice(start, end)
        const formData = new FormData()
        formData.append('sessionId', initPayload.session.sessionId)
        formData.append('chunkIndex', String(chunkIndex))
        formData.append('totalChunks', String(totalChunks))
        formData.append('chunk', chunkBlob, `${file.name}.part-${chunkIndex}`)
        const chunkResponse = await fetch('/api/uploads/chunk', { method: 'POST', body: formData })
        const chunkPayload = await chunkResponse.json()
        if (!chunkResponse.ok) { throw new Error(chunkPayload.error || t.chunkFailed) }
        updateUpload({ progress: 10 + Math.round(((chunkIndex + 1) / totalChunks) * 75), status: `${t.uploadedChunks} ${chunkIndex + 1}/${totalChunks}` })
      }
      const completeResponse = await fetch('/api/uploads/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: initPayload.session.sessionId, uploaderName: guestName, caption: '' }),
      })
      const completePayload = await completeResponse.json()
      if (!completeResponse.ok) {
        if (completePayload.limit === 'photo_count') { setPhotoLimitError(completePayload); updateUpload({ status: t.roomPhotoLimitReached }); return false }
        throw new Error(completePayload.error || t.uploadError)
      }
      updateUpload({ progress: 100, status: tCommon.done })
      setActiveEvent(completePayload.event); setGalleryError(''); return true
    } catch (error) {
      console.error('Upload failed', error)
      updateUpload({ status: tCommon.failed })
      return false
    }
  }

  const onFilesSelected = async (event) => {
    const fileList = Array.from(event.target.files || [])
    const input = event.target
    if (fileList.length === 0) return
    input.value = ''
    setUploadSuccess(false); setUploadFormatError(''); setShowViralSection(false); setPhotoLimitError(null)
    const supportedFiles = []; const unsupportedFiles = []
    for (const file of fileList) { if (isSupportedImageFile(file)) { supportedFiles.push(file) } else { unsupportedFiles.push(file) } }
    if (unsupportedFiles.length > 0) {
      setUploadFormatError(unsupportedFiles.length === 1 ? t.unsupportedFormatSingular : t.unsupportedFormatPlural)
      trackEvent(EVENT_UPLOAD_FILE_REJECTED, { room_slug: activeEvent?.slug, rejected_count: unsupportedFiles.length })
    }
    if (supportedFiles.length === 0) return
    setIsUploading(true); setLastUploadCount(supportedFiles.length)
    trackEvent(EVENT_UPLOAD_STARTED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length, is_second_upload: uploadCompletedTracked.current })
    const results = []
    for (const file of supportedFiles) { results.push(await uploadSingleFile(file)) }
    const allSucceeded = results.every(Boolean)
    setIsUploading(false); setUploadSuccess(allSucceeded)
    if (allSucceeded) {
      setShowViralSection(true); showToast(t.uploadSuccess)
      if (uploadCompletedTracked.current) { trackEvent(EVENT_SECOND_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length }) }
      else { uploadCompletedTracked.current = true; trackEvent(EVENT_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length }) }
    }
    if (heroFileInputRef.current) heroFileInputRef.current.value = ''
    if (cameraFileInputRef.current) cameraFileInputRef.current.value = ''
  }

  const openLightbox = (index) => { setLightboxIndex(index); setLightboxOpen(true) }

  const [galleryDownloadBusy, setGalleryDownloadBusy] = useState(false)

  const handleGalleryDownload = async () => {
    if (!activeEvent?.slug) return
    setGalleryDownloadBusy(true)
    trackEvent(EVENT_GALLERY_DOWNLOAD_CLICKED, { room_slug: activeEvent.slug, source: 'room_page' })
    try {
      const response = await fetch(`/api/download/gallery?eventSlug=${encodeURIComponent(activeEvent.slug)}`)
      if (response.status === 403) {
        trackEvent(EVENT_GALLERY_DOWNLOAD_BLOCKED, { room_slug: activeEvent.slug, source: 'room_page', reason: 'free_plan' })
        showToast(t.galleryDownloadLocked, 'error')
        setGalleryDownloadBusy(false)
        return
      }
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('content-disposition')
      const fileNameMatch = contentDisposition?.match(/filename="([^"]+)"/)
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `${activeEvent.name || activeEvent.slug}_gallery.zip`
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      trackEvent(EVENT_GALLERY_DOWNLOAD_COMPLETED, { room_slug: activeEvent.slug, source: 'room_page', photo_count: galleryPhotos.length })
      showToast(t.galleryDownloadStarted, 'success')
    } catch (err) {
      console.error('[room] gallery download failed:', err)
      showToast(t.galleryDownloadFailed, 'error')
    } finally {
      setGalleryDownloadBusy(false)
    }
  }

  useEffect(() => { loadEvent(slug); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug])
  useEffect(() => {
    if (!activeEvent?.slug) return undefined
    const interval = window.setInterval(() => { loadEvent(activeEvent.slug, { silent: true }) }, 3000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug])
  useEffect(() => {
    if (isNew && typeof window !== 'undefined') {
      try { const url = new URL(window.location.href); if (url.searchParams.has('new')) { url.searchParams.delete('new'); window.history.replaceState({}, '', url.toString()) } }
      catch (e) { console.warn(e) }
    }
  }, [isNew])
  useEffect(() => {
    if (!heroRef.current || typeof window === 'undefined') return
    let observer
    try {
      observer = new IntersectionObserver(([entry]) => { setShowStickyCta(!entry.isIntersecting) }, { threshold: 0, rootMargin: '0px' })
      observer.observe(heroRef.current)
    } catch (e) { console.warn(e) }
    return () => { try { observer?.disconnect() } catch {} }
  }, [activeEvent?.slug])

  if (notFound) {
    return (
      <main className="min-h-screen bg-background font-body text-foreground">
        <header className="border-b border-border bg-background/70 backdrop-blur-xl">
          <div className="container flex h-16 items-center justify-between px-4">
            <a href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle"><Camera className="h-[18px] w-[18px]" /></div>
              <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
            </a>
            {ownerSession?.authenticated && (
              <a href="/dashboard" className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground">
                <LayoutDashboard className="h-3.5 w-3.5" />Dashboard
              </a>
            )}
          </div>
        </header>
        <RoomNotFound />
      </main>
    )
  }

  return (
    <main className="relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.025] pointer-events-none" aria-hidden="true" />

      <header className="relative z-10 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle"><Camera className="h-[18px] w-[18px]" /></div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {ownerSession?.authenticated && (
              <a href="/dashboard" className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground">
                <LayoutDashboard className="h-3.5 w-3.5" />Dashboard
              </a>
            )}
          </div>
        </div>
      </header>

      {busy.join && !activeEvent ? (
        <div className="relative z-10 flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 px-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Camera className="h-7 w-7" /></div>
          <p className="text-lg font-light text-foreground">{t.loading}</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <section className="container relative z-10 px-4 py-8 pb-20">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Room info card */}
            <div className="rounded-2xl border border-border bg-surface shadow-card">
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomLabel}</span>
                    <h1 className="mt-1.5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">{activeEvent.name}</h1>
                  </div>
                  <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground" onClick={() => loadEvent(activeEvent.slug, { silent: true })}>
                    <RefreshCcw className={`h-4 w-4 ${busy.refresh ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-5 text-sm font-light text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" />{t.openForUploads}</span>
                  <span className="flex items-center gap-1.5"><ImagePlus className="h-4 w-4 text-primary" />{galleryPhotos.length} {t.photosLabel}</span>
                </div>
                <div className="mt-6 rounded-xl border border-border bg-raised p-5 text-center">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.roomCode}</p>
                  <p className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{activeEvent.slug}</p>
                  <p className="mt-1 text-xs font-light text-muted-foreground">{t.shareCodeHint}</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-elevated hover:bg-surface hover:text-foreground" onClick={async () => {
                      trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: activeEvent?.slug, source: 'room_info_card' })
                      try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          await navigator.clipboard.writeText(activeEvent.slug); setCopied(true); showToast(t.codeCopied); setTimeout(() => setCopied(false), 2000)
                        } else { showToast(t.copyNotSupported, 'error') }
                      } catch { showToast(t.failedToCopy, 'error') }
                    }}>
                      {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? tCommon.copied : tCommon.copy}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-elevated hover:bg-surface hover:text-foreground" onClick={async () => {
                      trackEvent(EVENT_NATIVE_SHARE_CLICKED, { room_slug: activeEvent?.slug, source: 'room_info_card' })
                      const shareData = { title: t.joinRoomOnSnapRooms.replace('{name}', activeEvent.name), text: t.uploadYourPhotosTo.replace('{name}', activeEvent.name) + ' ' + t.useCode + ': ' + activeEvent.slug }
                      if (typeof navigator !== 'undefined' && navigator.share) { try { await navigator.share(shareData); showToast(t.shared) } catch {} }
                      else { try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t.uploadYourPhotosTo.replace('{name}', activeEvent.name) + ' ' + t.useCode + ': ' + activeEvent.slug); showToast(t.inviteCopied) } else { showToast(t.shareNotSupported, 'error') } } catch { showToast(t.failedToCopy, 'error') } }
                    }}>
                      <Share2 className="h-3.5 w-3.5" />{t.nativeShare}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-elevated hover:bg-surface hover:text-foreground" onClick={() => { trackEvent(EVENT_QR_OPENED, { room_slug: activeEvent?.slug, source: 'room_info_card' }); setQrModalOpen(true) }}>
                      <QrCode className="h-3.5 w-3.5" />{t.showQR}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Upload hero */}
            <div ref={heroRef} className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
              <div className="p-6 text-center sm:p-8">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Camera className="h-7 w-7" />
                </div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t.addYourPhotos}</h2>
                <p className="mt-2 text-base font-light leading-relaxed text-muted-foreground">{t.bePartOf} {activeEvent.name}</p>
                <p className="mt-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {galleryPhotos.length > 0 ? `${galleryPhotos.length} ${t.photosShared}` : t.beFirst}
                </p>
                <div className="mt-6 mx-auto max-w-sm">
                  <div className="space-y-2 text-left">
                    <label className="text-sm font-medium text-foreground">{t.guestNamePlaceholder}</label>
                    <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder={t.yourName} className="h-11 rounded-xl border-border bg-raised text-foreground placeholder:text-muted-foreground" />
                  </div>
                </div>

                {uploadSuccess && (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-5 py-3 text-sm font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    {lastUploadCount === 1 ? t.yourPhotoIsInRoom : t.yourPhotosAreInRoom}
                  </div>
                )}
                {uploadFormatError && (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-3 text-sm font-medium text-destructive">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {uploadFormatError}
                  </div>
                )}
                {photoLimitError && (
                  <div className="mt-6 rounded-xl border border-warning/20 bg-warning/10 px-5 py-4 text-left">
                    {ownerSession?.authenticated && ownerSession?.email?.toLowerCase() === activeEvent?.ownerEmail?.toLowerCase() ? (
                      <>
                        <p className="text-sm font-semibold text-warning">{t.freeLimitReached}</p>
                        <p className="mt-1 text-xs font-light text-muted-foreground">{t.upgradeToContinueOwner}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" className="cta-primary" asChild><a href="/pricing">{tCommon.viewPricing}</a></Button>
                          <Button size="sm" variant="outline" className="border-border bg-raised" onClick={() => { if (typeof window !== 'undefined') { window.location.href = '/dashboard' } }}>{t.upgradeThisRoom}</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-warning">{t.photoLimitReachedGuest}</p>
                        <p className="mt-1 text-xs font-light text-muted-foreground">{t.askOwnerToUpgrade}</p>
                      </>
                    )}
                  </div>
                )}

                {isUploading ? (
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-raised px-5 py-3 text-sm font-medium text-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {`${t.uploading} ${uploads.filter((u) => u.progress < 100).length} ${t.photosLabel}...`}
                  </div>
                ) : (
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button size="lg" className="h-14 gap-2 rounded-xl px-8 text-base font-body font-semibold cta-primary touch-target" disabled={Boolean(photoLimitError)} onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_SNAP_CTA_CLICKED, { room_slug: activeEvent?.slug }); cameraFileInputRef.current?.click() }}>
                      <Camera className="h-5 w-5" />{t.snapPhoto}
                    </Button>
                    <Button size="lg" variant="outline" className="h-14 gap-2 rounded-xl px-8 text-base font-body font-semibold border-border bg-raised hover:bg-elevated hover:text-foreground touch-target" disabled={Boolean(photoLimitError)} onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug }); heroFileInputRef.current?.click() }}>
                      <Upload className="h-5 w-5" />{t.uploadPhoto}
                    </Button>
                  </div>
                )}
                <p className="mt-5 text-xs font-light text-muted-foreground">{t.noAppNeeded}</p>
              </div>
            </div>

            <input ref={heroFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={onFilesSelected} />
            <input ref={cameraFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" className="hidden" onChange={onFilesSelected} />

            {/* Viral share */}
            {showViralSection && (
              <div className="mt-2 rounded-2xl border border-success/20 bg-success/5">
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-base font-bold text-foreground">{t.inviteOthers}</p>
                      <p className="mt-1 text-sm font-light leading-relaxed text-muted-foreground">{t.viralDesc}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground" onClick={() => setShowViralSection(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1.5 bg-[#25D366] text-foreground hover:bg-[#128C7E] border-transparent" onClick={() => { trackEvent(EVENT_WHATSAPP_SHARE_CLICKED, { room_slug: activeEvent?.slug, source: 'viral_section' }); try { window.open(`https://wa.me/?text=${encodeURIComponent(`📸 Photos from ${activeEvent.name}\n\nAdd yours here 👇\n${baseUrl}/event/${activeEvent.slug}`)}`, '_blank') } catch (e) { console.warn(e) } }}>
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      {t.shareOnWhatsApp}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={async () => { trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: activeEvent?.slug, source: 'viral_section' }); try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`); showToast(t.copied + '!') } else { showToast(t.copy + ' ' + t.error, 'error') } } catch { showToast(t.error, 'error') } }}>
                      <Copy className="h-3.5 w-3.5" />{t.copyLink}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={async () => { trackEvent(EVENT_NATIVE_SHARE_CLICKED, { room_slug: activeEvent?.slug, source: 'viral_section' }); const shareData = { title: t.joinRoomOnSnapRooms.replace('{name}', activeEvent.name), text: t.uploadYourPhotosTo.replace('{name}', activeEvent.name), url: `${baseUrl}/event/${activeEvent.slug}` }; if (typeof navigator !== 'undefined' && navigator.share) { try { await navigator.share(shareData); showToast(t.shared) } catch {} } else { try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`); showToast(t.copied + '!') } else { showToast(t.share + ' ' + t.error, 'error') } } catch { showToast(t.error, 'error') } } }}>
                      <Share2 className="h-3.5 w-3.5" />{t.nativeShare}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-border bg-raised hover:bg-elevated hover:text-foreground" onClick={() => { trackEvent(EVENT_QR_OPENED, { room_slug: activeEvent?.slug, source: 'viral_section' }); setQrModalOpen(true) }}>
                      <QrCode className="h-3.5 w-3.5" />{t.showQR}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {isNew && !newRoomBannerDismissed && (
              <NewRoomShareBanner event={activeEvent} baseUrl={baseUrl} onDismiss={() => setNewRoomBannerDismissed(true)} showToast={showToast} onShowQR={() => { trackEvent(EVENT_QR_OPENED, { room_slug: activeEvent?.slug, source: 'new_room_banner' }); setQrModalOpen(true) }} />
            )}

            <InstallCta mode="room" className="mt-2" />

            {uploads.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploads.map((upload) => (
                  <div key={upload.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{upload.name}</p>
                      <p className="text-xs font-light text-muted-foreground">{upload.status}</p>
                    </div>
                    {upload.progress === 100 ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Clock3 className="h-4 w-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>
            )}

            {/* Gallery */}
            <div className="mt-8 rounded-2xl border border-border bg-surface shadow-card">
              <div className="p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.galleryTitle}</span>
                    <Badge variant="secondary" className="rounded-full font-mono text-[10px] bg-raised text-muted-foreground border-border">{galleryPhotos.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={galleryDownloadBusy || galleryPhotos.length === 0}
                    onClick={handleGalleryDownload}
                    className="border-border bg-raised hover:bg-elevated hover:text-foreground"
                  >
                    {galleryDownloadBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    {t.downloadAll || 'Download all'}
                  </Button>
                </div>
                {unlockMessage && <p className="mt-3 text-sm font-semibold text-success">{unlockMessage}</p>}
                <div className="mt-2 space-y-1">
                  {isFreeEvent ? (
                    <>
                      <p className="text-xs text-muted-foreground">{t.brandingFreeLocked}</p>
                      <p className="text-xs text-muted-foreground">{t.galleryDownloadLocked}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-success">{t.brandingFreeAvailable}</p>
                      <p className="text-xs text-success">{t.galleryDownloadAvailable}</p>
                    </>
                  )}
                </div>
                <div className="mt-6">
                  <PhotoGalleryGrid photos={galleryPhotos} loading={galleryLoading} error={galleryError} onRetry={() => activeEvent?.slug && loadEvent(activeEvent.slug)} onSelectPhoto={openLightbox} />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 transition-opacity duration-200 sm:hidden ${showStickyCta ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <Button size="sm" className="h-12 gap-2 rounded-full px-7 text-sm font-body font-semibold cta-primary" onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_SNAP_CTA_CLICKED, { room_slug: activeEvent?.slug, position: 'sticky_mobile' }); cameraFileInputRef.current?.click() }}>
          <Camera className="h-4 w-4" />{t.snapPhotoShort}
        </Button>
      </div>

      <EventQRModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} event={activeEvent} baseUrl={baseUrl} />
      <PhotoLightbox onOpenChange={setLightboxOpen} onSelectIndex={setLightboxIndex} open={lightboxOpen} photos={galleryPhotos} selectedIndex={lightboxIndex} event={activeEvent} isOwner={ownerSession?.authenticated && ownerSession?.email?.toLowerCase() === activeEvent?.ownerEmail?.toLowerCase()} />
      <ToastComponent />
    </main>
  )
}
