'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Camera,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ImagePlus,
  Images,
  LayoutDashboard,
  Loader2,
  PartyPopper,
  QrCode,
  RefreshCcw,
  Share2,
  Upload,
  Users,
  WifiOff,
  FileWarning,
  ArrowDown,
  X,
} from 'lucide-react'
import PhotoGalleryGrid from '@/components/photo-gallery-grid'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
import { getSortedRenderablePhotos, getRenderablePhotos } from '@/lib/photo-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { trackEvent } from '@/lib/analytics/track-client'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
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
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { resolveAllUpsells } from '@/lib/upsell-context'
import { UpsellRow } from '@/components/upsell-row'

const CHUNK_SIZE = 1024 * 1024

const UPLOAD_STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  DONE: 'done',
  ERROR: 'error',
}

function getUploadStatusLabel(upload, t, tCommon) {
  switch (upload.status) {
    case UPLOAD_STATUS.QUEUED:
      return upload.detail || t.preparingUpload
    case UPLOAD_STATUS.UPLOADING:
      return upload.detail || t.uploadingPhotos
    case UPLOAD_STATUS.DONE:
      return tCommon.done
    case UPLOAD_STATUS.ERROR:
      return upload.errorMessage || t.uploadFailedTryAgain
    default:
      return ''
  }
}

const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

function isSupportedImageFile(file) {
  if (file.type && SUPPORTED_MIME_TYPES.includes(file.type.toLowerCase())) {
    return true
  }
  const name = file.name?.toLowerCase() || ''
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function dedupePhotosById(photos) {
  const seen = new Set()
  return photos.filter((p) => {
    if (!p?.id || seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
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
  const [photos, setPhotos] = useState([])
  const [photoSort, setPhotoSort] = useState('recent')
  const [photoCursor, setPhotoCursor] = useState(null)
  const [hasMorePhotos, setHasMorePhotos] = useState(false)
  const [loadingMorePhotos, setLoadingMorePhotos] = useState(false)
  const [galleryJob, setGalleryJob] = useState(null)
  const [galleryJobPolling, setGalleryJobPolling] = useState(false)
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
  const [newPhotosAvailable, setNewPhotosAvailable] = useState(false)
  const [newPhotosCount, setNewPhotosCount] = useState(0)
  const [galleryBlockedModalOpen, setGalleryBlockedModalOpen] = useState(false)
  const heroFileInputRef = useRef(null)
  const cameraFileInputRef = useRef(null)
  const heroRef = useRef(null)
  const galleryRef = useRef(null)
  const roomViewTracked = useRef(false)
  const uploadCompletedTracked = useRef(false)
  const { showToast, ToastComponent } = useToast()
  const fetchControllerRef = useRef(null)
  const isFetchingRef = useRef(false)
  const pollTimeoutRef = useRef(null)
  const pollBackoffRef = useRef(3000)
  const consecutiveErrorsRef = useRef(0)
  const previousPhotoCountRef = useRef(0)
  const hasPhotoCountHydratedRef = useRef(false)
  const lastLocalUploadAt = useRef(null)
  const ignoreNextPhotoCountChangeRef = useRef(false)

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
    try { return getRenderablePhotos(photos) }
    catch (pipelineError) { console.error('[room] photo pipeline crashed', { slug: activeEvent?.slug, error: pipelineError }); return [] }
  }, [photos])

  const eventAccess = useMemo(() => {
    if (!activeEvent) return { isFree: true, hasUnbrandedDownloads: false, canDownloadGallery: false }
    return resolveEffectiveEventAccessState({
      billingTier: activeEvent.billingTier,
      originalDownloadUnlocked: activeEvent.originalDownloadUnlocked,
      ownerPlan: activeEvent.ownerPlan,
    })
  }, [activeEvent])

  const isEventOwner = useMemo(() => {
    if (!ownerSession?.authenticated || !activeEvent?.ownerEmail) return false
    return ownerSession.email.toLowerCase() === activeEvent.ownerEmail.toLowerCase()
  }, [ownerSession, activeEvent?.ownerEmail])

  const loadEvent = async (targetSlug, { silent = false, force = false } = {}) => {
    if (!targetSlug) return
    if (!force && isFetchingRef.current) {
      console.log(`[room:${targetSlug}] loadEvent skipped, already in flight`)
      return
    }
    isFetchingRef.current = true

    // Abort previous fetch to avoid race conditions
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort()
    }
    fetchControllerRef.current = new AbortController()

    setGalleryError('')
    if (silent) { setBusy((current) => ({ ...current, refresh: true })) }
    else { setBusy((current) => ({ ...current, join: true })); setGalleryLoading(true) }
    try {
      const response = await fetch(`/api/events/${targetSlug}`, { cache: 'no-store', signal: fetchControllerRef.current.signal })
      const payload = await response.json()
      if (!response.ok) {
        if (response.status === 404) { setNotFound(true) }
        throw new Error(payload.error || t.unableToOpenGallery)
      }
      setActiveEvent(payload.event)
      consecutiveErrorsRef.current = 0
      pollBackoffRef.current = 3000
      if (!roomViewTracked.current) {
        roomViewTracked.current = true
        trackEvent(EVENT_ROOM_VIEWED, {
          room_slug: payload.event?.slug, room_name: payload.event?.name,
          is_new_room: isNew, photo_count: payload.event?.photos?.length || 0,
        })
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`[room:${targetSlug}] loadEvent aborted`)
        return
      }
      consecutiveErrorsRef.current += 1
      pollBackoffRef.current = Math.min(pollBackoffRef.current * 2, 30000)
      console.warn(`[room:${targetSlug}] loadEvent error #${consecutiveErrorsRef.current}: ${error.message}. Backoff=${pollBackoffRef.current}ms`)
      setGalleryError(error.message || t.unableToLoadGallery)
    } finally {
      isFetchingRef.current = false
      if (silent) { setBusy((current) => ({ ...current, refresh: false })) }
      else { setBusy((current) => ({ ...current, join: false })); setGalleryLoading(false) }
    }
  }

  const uploadSingleFile = async (file) => {
    if (!activeEvent?.slug) return false
    const localId = `${file.name}-${file.lastModified}`
    setUploads((current) => [{ id: localId, name: file.name, size: file.size, progress: 2, status: UPLOAD_STATUS.QUEUED, detail: t.preparingUpload, errorMessage: '' }, ...current])
    const updateUpload = (next) => { setUploads((current) => current.map((item) => item.id === localId ? { ...item, ...next } : item)) }
    try {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const initResponse = await fetch('/api/uploads/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug: activeEvent.slug, fileName: file.name, fileSize: file.size, mimeType: file.type || 'image/jpeg', totalChunks }),
      })
      const initPayload = await initResponse.json()
      if (!initResponse.ok) {
        if (initPayload.limit === 'photo_count') { setPhotoLimitError(initPayload); updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached }); return false }
        throw new Error(initPayload.error || t.uploadError)
      }
      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        updateUpload({ progress: 8, status: UPLOAD_STATUS.UPLOADING, detail: t.uploading + ' ' + t.galleryTitle })
        const blob = await upload(initPayload.session.pathname || file.name, file, {
          access: 'public', handleUploadUrl: initPayload.session.handleUploadUrl || '/api/uploads/blob',
          clientPayload: JSON.stringify({ eventSlug: activeEvent.slug, fileName: file.name, fileSize: file.size, mimeType: file.type || 'image/jpeg' }),
          multipart: file.size > 5 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => { updateUpload({ progress: 10 + Math.round((percentage / 100) * 75), status: UPLOAD_STATUS.UPLOADING, detail: `${t.uploadedPercent} ${Math.round(percentage)}%` }) },
        })
        updateUpload({ progress: 90, status: UPLOAD_STATUS.UPLOADING, detail: t.finalizingGallery })
        const completeResponse = await fetch('/api/uploads/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventSlug: activeEvent.slug, blobUrl: blob.url, blobPathname: blob.pathname, originalName: file.name, mimeType: file.type || 'image/jpeg', size: file.size, uploaderName: guestName, caption: '' }),
        })
        const completePayload = await completeResponse.json()
        if (!completeResponse.ok) {
          if (completePayload.limit === 'photo_count') { setPhotoLimitError(completePayload); updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached }); return false }
          throw new Error(completePayload.error || t.uploadError)
        }
        updateUpload({ progress: 100, status: UPLOAD_STATUS.DONE })
        setActiveEvent(completePayload.event); setGalleryError(''); return true
      }
      updateUpload({ progress: 8, status: UPLOAD_STATUS.UPLOADING })
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
        updateUpload({ progress: 10 + Math.round(((chunkIndex + 1) / totalChunks) * 75), status: UPLOAD_STATUS.UPLOADING, detail: `${t.uploadedChunks} ${chunkIndex + 1}/${totalChunks}` })
      }
      const completeResponse = await fetch('/api/uploads/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: initPayload.session.sessionId, uploaderName: guestName, caption: '' }),
      })
      const completePayload = await completeResponse.json()
      if (!completeResponse.ok) {
        if (completePayload.limit === 'photo_count') { setPhotoLimitError(completePayload); updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached }); return false }
        throw new Error(completePayload.error || t.uploadError)
      }
      updateUpload({ progress: 100, status: UPLOAD_STATUS.DONE })
      setActiveEvent(completePayload.event); setGalleryError(''); return true
    } catch (error) {
      console.error('Upload failed', error)
      updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: tCommon.failed })
      return false
    }
  }

  const MAX_FILE_SIZE = 25 * 1024 * 1024

  const onFilesSelected = async (event) => {
    const fileList = Array.from(event.target.files || [])
    const input = event.target
    if (fileList.length === 0) return
    input.value = ''
    setUploadSuccess(false); setUploadFormatError(''); setShowViralSection(false); setPhotoLimitError(null)
    const supportedFiles = []; const unsupportedFiles = []; const oversizedFiles = []
    for (const file of fileList) {
      if (!isSupportedImageFile(file)) { unsupportedFiles.push(file) }
      else if (file.size > MAX_FILE_SIZE) { oversizedFiles.push(file) }
      else { supportedFiles.push(file) }
    }
    if (unsupportedFiles.length > 0) {
      setUploadFormatError(unsupportedFiles.length === 1 ? t.unsupportedFormatSingular : t.unsupportedFormatPlural)
      trackEvent(EVENT_UPLOAD_FILE_REJECTED, { room_slug: activeEvent?.slug, rejected_count: unsupportedFiles.length })
    }
    if (oversizedFiles.length > 0) {
      setUploadFormatError(t.fileTooLarge)
      trackEvent(EVENT_UPLOAD_FILE_REJECTED, { room_slug: activeEvent?.slug, rejected_count: oversizedFiles.length, reason: 'file_too_large' })
    }
    if (supportedFiles.length === 0) return
    setIsUploading(true); setLastUploadCount(supportedFiles.length); setUploads([])
    trackEvent(EVENT_UPLOAD_STARTED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length, is_second_upload: uploadCompletedTracked.current })
    const results = []
    for (const file of supportedFiles) { results.push(await uploadSingleFile(file)) }
    const allSucceeded = results.every(Boolean)
    setIsUploading(false)
    if (allSucceeded) {
      setUploadSuccess(true)
      setUploads([])
      setShowViralSection(true); showToast(t.uploadSuccess)
      if (uploadCompletedTracked.current) { trackEvent(EVENT_SECOND_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length }) }
      else { uploadCompletedTracked.current = true; trackEvent(EVENT_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: supportedFiles.length }) }
      await refreshGalleryAfterUpload()
      lastLocalUploadAt.current = Date.now()
    } else {
      const someSucceeded = results.some(Boolean)
      setUploadSuccess(false)
      if (someSucceeded) {
        setUploadFormatError(t.somePhotosFailed || t.uploadFailedTryAgain)
      } else {
        setUploadFormatError(t.uploadFailedTryAgain)
      }
      setUploads((prev) => prev.filter((u) => u.status !== UPLOAD_STATUS.DONE))
      if (someSucceeded) {
        await refreshGalleryAfterUpload()
      }
    }
    if (heroFileInputRef.current) heroFileInputRef.current.value = ''
    if (cameraFileInputRef.current) cameraFileInputRef.current.value = ''
  }

  const openLightbox = (index) => { setLightboxIndex(index); setLightboxOpen(true) }

  const [galleryDownloadBusy, setGalleryDownloadBusy] = useState(false)

  const loadPhotos = async ({ reset = false, sortOverride } = {}) => {
    if (!activeEvent?.slug) return
    const targetSort = sortOverride || photoSort
    const cursor = reset ? null : photoCursor
    setLoadingMorePhotos(true)
    setGalleryError('')
    try {
      const url = new URL(`/api/events/${activeEvent.slug}/photos`, window.location.origin)
      if (cursor) url.searchParams.set('cursor', cursor)
      url.searchParams.set('sort', targetSort)
      const response = await fetch(url.toString(), { cache: 'no-store' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || t.unableToLoadGallery)
      }
      const data = await response.json()
      if (reset) {
        setPhotos(dedupePhotosById(data.photos || []))
      } else {
        setPhotos((prev) => dedupePhotosById([...prev, ...(data.photos || [])]))
      }
      setPhotoCursor(data.nextCursor)
      setHasMorePhotos(Boolean(data.nextCursor))
    } catch (error) {
      console.error('[room] loadPhotos error:', error)
      setGalleryError(error.message || t.unableToLoadGallery)
    } finally {
      setLoadingMorePhotos(false)
    }
  }

  const refreshGalleryAfterUpload = async () => {
    if (!activeEvent?.slug) return
    try {
      // 1. Forza sort su recent
      setPhotoSort('recent')
      // 2. Resetta paginazione
      setPhotos([])
      setPhotoCursor(null)
      setHasMorePhotos(false)
      setGalleryError('')
      // 3. Fetch primo batch
      const url = new URL(`/api/events/${activeEvent.slug}/photos`, window.location.origin)
      url.searchParams.set('take', '24')
      url.searchParams.set('sort', 'recent')
      const response = await fetch(url.toString(), { cache: 'no-store' })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || t.unableToLoadGallery)
      }
      const data = await response.json()
      // 4. Aggiorna gallery con dedup
      setPhotos(dedupePhotosById(data.photos || []))
      setPhotoCursor(data.nextCursor)
      setHasMorePhotos(Boolean(data.nextCursor))
      // 5. Aggiorna photoCount dalla source of truth
      if (typeof data.total === 'number') {
        setActiveEvent((prev) => (prev ? { ...prev, photoCount: data.total } : prev))
      }
      return data.total
    } catch (error) {
      console.error('[room] refreshGalleryAfterUpload error:', error)
      // Non sovrascrivere uploadSuccess; mostriamo solo un toast leggero
      showToast(t.unableToLoadGallery, 'error')
    }
  }

  const handleSortChange = (newSort) => {
    if (newSort === photoSort) return
    setPhotoSort(newSort)
    setPhotos([])
    setPhotoCursor(null)
    setHasMorePhotos(false)
    loadPhotos({ reset: true, sortOverride: newSort })
  }

  const handleRefreshNewPhotos = async () => {
    ignoreNextPhotoCountChangeRef.current = true
    setNewPhotosAvailable(false)
    setNewPhotosCount(0)
    await refreshGalleryAfterUpload()
  }

  const handleGalleryDownload = async () => {
    if (!activeEvent?.slug) return
    if (!eventAccess.canDownloadGallery) {
      setGalleryBlockedModalOpen(true)
      return
    }
    setGalleryDownloadBusy(true)
    trackEvent(EVENT_GALLERY_DOWNLOAD_CLICKED, { room_slug: activeEvent.slug, source: 'room_page' })

    // Sync download for small galleries (immediate)
    if ((activeEvent.photoCount || 0) <= 200) {
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
      return
    }

    // Async job for large galleries
    try {
      const createRes = await fetch(`/api/events/${activeEvent.slug}/gallery-download`, { method: 'POST' })
      const createData = await createRes.json()
      if (!createRes.ok) {
        throw new Error(createData.error || 'Failed to start gallery download')
      }
      setGalleryJob(createData.job)
      setGalleryJobPolling(true)

      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/events/${activeEvent.slug}/gallery-download`)
          const statusData = await statusRes.json()
          setGalleryJob(statusData.job)

          const job = statusData.job
          if (!job) {
            setGalleryJobPolling(false)
            setGalleryDownloadBusy(false)
            return
          }

          if (job.status === 'READY') {
            window.location.href = `/api/gallery-downloads/${job.id}/download`
            setGalleryJobPolling(false)
            setGalleryDownloadBusy(false)
            trackEvent(EVENT_GALLERY_DOWNLOAD_COMPLETED, { room_slug: activeEvent.slug, source: 'room_page_async', photo_count: activeEvent.photoCount })
            showToast(t.galleryReady || 'Gallery ready', 'success')
            return
          }

          if (job.status === 'FAILED') {
            setGalleryJobPolling(false)
            setGalleryDownloadBusy(false)
            const errorMsg = job.error || ''
            if (errorMsg.toLowerCase().includes('too large') || errorMsg.includes('1000')) {
              showToast(t.galleryExportTooLarge || 'Gallery too large for immediate export', 'error')
            } else if (errorMsg.toLowerCase().includes('maximum') || errorMsg.toLowerCase().includes('attempts')) {
              showToast(t.galleryExportRetryLater || 'Gallery export failed after multiple attempts. Please try again later.', 'error')
            } else {
              showToast(t.galleryDownloadFailed, 'error')
            }
            return
          }

          // PENDING or PROCESSING: continue polling
          setTimeout(poll, 3000)
        } catch (pollErr) {
          console.error('[room] gallery job polling error:', pollErr)
          setGalleryJobPolling(false)
          setGalleryDownloadBusy(false)
          showToast(t.galleryDownloadFailed, 'error')
        }
      }
      poll()
    } catch (err) {
      console.error('[room] async gallery download failed:', err)
      showToast(t.galleryDownloadFailed, 'error')
      setGalleryDownloadBusy(false)
    }
  }

  const handleUnlockGalleryFromModal = () => {
    const actorType = isEventOwner ? 'owner' : ownerSession?.authenticated ? 'unknown' : 'guest'
    trackUpsellClick({
      upsellType: 'gallery_zip',
      source: 'room_page_gallery_blocked',
      location: 'room_page',
      eventSlug: activeEvent?.slug,
      eventId: activeEvent?.id,
      ownerPlan: ownerSession?.authenticated ? eventAccess.effectivePlan : 'guest',
      billingTier: activeEvent?.billingTier,
      effectivePlan: eventAccess.effectivePlan,
      ctaPlan: isEventOwner ? 'pro_event' : 'none',
      actorType,
    })
    if (typeof window !== 'undefined') {
      if (isEventOwner && activeEvent?.slug) {
        const params = new URLSearchParams({
          plan: 'pro_event',
          from: 'gallery_blocked',
          eventSlug: activeEvent.slug,
        })
        window.location.href = `/pricing?${params.toString()}`
      } else {
        window.location.href = '/?from=gallery_blocked_guest'
      }
    }
  }

  useEffect(() => {
    loadEvent(slug)
    return () => {
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  useEffect(() => {
    if (!activeEvent?.slug || notFound) {
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
      return undefined
    }

    const schedulePoll = () => {
      pollTimeoutRef.current = window.setTimeout(async () => {
        await loadEvent(activeEvent.slug, { silent: true })
        // Schedule next poll only if still relevant
        if (pollTimeoutRef.current !== null && !notFound) {
          schedulePoll()
        }
      }, pollBackoffRef.current)
    }

    schedulePoll()
    return () => {
      if (pollTimeoutRef.current) {
        window.clearTimeout(pollTimeoutRef.current)
        pollTimeoutRef.current = null
      }
      if (fetchControllerRef.current) {
        fetchControllerRef.current.abort()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.slug, notFound])

  useEffect(() => {
    if (typeof activeEvent?.photoCount !== 'number') return
    const currentCount = activeEvent.photoCount
    const previousCount = previousPhotoCountRef.current

    if (ignoreNextPhotoCountChangeRef.current) {
      ignoreNextPhotoCountChangeRef.current = false
      previousPhotoCountRef.current = currentCount
      return
    }

    if (hasPhotoCountHydratedRef.current && currentCount > previousCount) {
      if (!lastLocalUploadAt.current || Date.now() - lastLocalUploadAt.current > 8000) {
        setNewPhotosAvailable(true)
        setNewPhotosCount((prev) => prev + (currentCount - previousCount))
      }
    } else {
      hasPhotoCountHydratedRef.current = true
    }

    previousPhotoCountRef.current = currentCount
  }, [activeEvent?.photoCount])

  useEffect(() => {
    if (galleryBlockedModalOpen && activeEvent?.slug) {
      const actorType = isEventOwner ? 'owner' : ownerSession?.authenticated ? 'unknown' : 'guest'
      trackUpsellImpression({
        upsellType: 'gallery_zip',
        source: 'room_page_gallery_blocked',
        location: 'room_page',
        eventSlug: activeEvent.slug,
        eventId: activeEvent.id,
        ownerPlan: ownerSession?.authenticated ? eventAccess.effectivePlan : 'guest',
        billingTier: activeEvent.billingTier,
        effectivePlan: eventAccess.effectivePlan,
        ctaPlan: isEventOwner ? 'pro_event' : 'none',
        actorType,
      })
    }
  }, [galleryBlockedModalOpen, activeEvent?.slug, activeEvent?.id, activeEvent?.billingTier, eventAccess.effectivePlan, ownerSession?.authenticated, isEventOwner])

  useEffect(() => {
    if (activeEvent?.slug) {
      loadPhotos({ reset: true })
    }
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
            <Link href={ownerSession?.authenticated ? '/dashboard' : '/'} className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle"><Camera className="h-[18px] w-[18px]" /></div>
              <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
            </Link>
            {ownerSession?.authenticated && (
              <Link href="/dashboard" className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground">
                <LayoutDashboard className="h-3.5 w-3.5" />Dashboard
              </Link>
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
          <Link href={ownerSession?.authenticated ? '/dashboard' : '/'} className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-subtle"><Camera className="h-[18px] w-[18px]" /></div>
            <span className="font-display text-[15px] font-bold tracking-tight text-foreground">SnapRooms</span>
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {ownerSession?.authenticated && (
              <Link href="/dashboard" className="flex items-center gap-1.5 text-sm font-light text-muted-foreground transition-colors hover:text-foreground">
                <LayoutDashboard className="h-3.5 w-3.5" />Dashboard
              </Link>
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
        <section className="container relative z-10 px-4 py-8 pb-28 sm:pb-20">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Room info header */}
            <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
              {activeEvent.coverUrl ? (
                <div className="relative h-40 sm:h-56 w-full overflow-hidden">
                  <img
                    src={activeEvent.coverUrl}
                    alt={activeEvent.name}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
                    <span className="inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-md">{t.roomLabel}</span>
                    <h1 className="mt-1.5 font-display text-xl font-bold tracking-tight text-white sm:text-2xl">{activeEvent.name}</h1>
                  </div>
                </div>
              ) : (
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomLabel}</span>
                      <h1 className="mt-1.5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">{activeEvent.name}</h1>
                    </div>
                    <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground" onClick={() => loadEvent(activeEvent.slug, { silent: true, force: true })} aria-label={t.retry}>
                      <RefreshCcw className={`h-4 w-4 ${busy.refresh ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
              )}
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="flex flex-wrap items-center gap-4 text-sm font-light text-muted-foreground">
                  <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" />{t.openForUploads}</span>
                  <span className="flex items-center gap-1.5"><ImagePlus className="h-4 w-4 text-primary" />{activeEvent?.photoCount || galleryPhotos.length} {t.photosLabel}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5 border-border bg-elevated hover:bg-surface hover:text-foreground" onClick={async () => {
                    trackEvent(EVENT_COPY_LINK_CLICKED, { room_slug: activeEvent?.slug, source: 'room_info_card' })
                    try {
                      if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(`${baseUrl}/event/${activeEvent.slug}`); setCopied(true); showToast(t.linkCopied); setTimeout(() => setCopied(false), 2000)
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

            {/* Upload hero */}
            <div ref={heroRef} className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
              <div className="p-6 text-center sm:p-8">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Images className="h-7 w-7" />
                </div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t.addYourPhotos}</h2>
                <p className="mt-2 text-base font-light leading-relaxed text-muted-foreground max-w-md mx-auto">
                  {galleryPhotos.length === 0 ? t.shareYourMoments : t.heroSubtitle}
                </p>

                {/* Guest onboarding — visible when gallery is empty */}
                {galleryPhotos.length === 0 && !isUploading && !uploadSuccess && (
                  <div className="mt-5 inline-flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 rounded-xl bg-raised px-4 py-3 text-left sm:text-center">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">1</span>{t.step1ChoosePhotos}</span>
                    <span className="hidden sm:block h-px w-4 bg-border" />
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">2</span>{t.step2Upload}</span>
                    <span className="hidden sm:block h-px w-4 bg-border" />
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">3</span>{t.step3Enjoy}</span>
                  </div>
                )}

                <div className="mt-6 mx-auto max-w-sm">
                  <div className="space-y-2 text-left">
                    <label htmlFor="guest-name" className="text-sm font-medium text-foreground">{t.guestNamePlaceholder}</label>
                    <Input id="guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder={t.yourName} className="h-11 rounded-xl border-border bg-raised text-foreground placeholder:text-muted-foreground" />
                  </div>
                </div>

                {/* Post-upload success */}
                {uploadSuccess && (
                  <div className="mt-6 rounded-2xl border border-success/20 bg-success/5 px-5 py-5 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                      <PartyPopper className="h-6 w-6 text-success" />
                    </div>
                    <p className="mt-3 font-display text-lg font-bold text-foreground">{t.photosUploadedSuccessfully}</p>
                    <p className="mt-1 text-sm font-light text-muted-foreground">{t.thanksForSharing}</p>
                    <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center">
                      <Button size="sm" className="cta-primary" onClick={() => { heroFileInputRef.current?.click() }}>
                        <Upload className="h-4 w-4 mr-1.5" />{t.uploadMore}
                      </Button>
                      <Button size="sm" variant="outline" className="border-border bg-raised hover:bg-elevated" onClick={() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                        <ArrowDown className="h-4 w-4 mr-1.5" />{t.viewGallery}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Errors */}
                {uploadFormatError && (
                  <div className="mt-6 inline-flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-3 text-sm font-medium text-destructive text-left">
                    <FileWarning className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{uploadFormatError}</span>
                  </div>
                )}
                {photoLimitError && (
                  <div className="mt-6 rounded-xl border border-warning/20 bg-warning/10 px-5 py-4 text-left">
                    {isEventOwner ? (
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

                {/* Upload progress */}
                {isUploading ? (
                  <div className="mt-6 mx-auto max-w-md rounded-2xl border border-border bg-raised p-5 text-left">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{t.uploadingPhotos}</p>
                        <p className="text-xs text-muted-foreground">
                          {uploads.filter((u) => u.status === UPLOAD_STATUS.DONE).length} / {uploads.length} {t.photosLabel}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${Math.round((uploads.filter((u) => u.status === UPLOAD_STATUS.DONE).length / uploads.length) * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Button size="lg" className="h-14 gap-2 rounded-xl px-8 text-base font-body font-semibold cta-primary touch-target" disabled={Boolean(photoLimitError)} aria-label={t.snapPhoto} onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_SNAP_CTA_CLICKED, { room_slug: activeEvent?.slug }); cameraFileInputRef.current?.click() }}>
                      <Camera className="h-5 w-5" />{t.snapPhoto}
                    </Button>
                    <Button size="lg" variant="outline" className="h-14 gap-2 rounded-xl px-8 text-base font-body font-semibold border-border bg-raised hover:bg-elevated hover:text-foreground touch-target" disabled={Boolean(photoLimitError)} aria-label={t.uploadPhoto} onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug }); heroFileInputRef.current?.click() }}>
                      <Upload className="h-5 w-5" />{t.uploadPhoto}
                    </Button>
                  </div>
                )}
                <p className="mt-5 text-xs font-light text-muted-foreground">{t.noAppNeeded}</p>
              </div>
            </div>

            <input ref={heroFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={onFilesSelected} aria-label={t.uploadPhoto} />
            <input ref={cameraFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" className="hidden" onChange={onFilesSelected} aria-label={t.snapPhoto} />

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
              <div className="mt-4 space-y-3" role="region" aria-label={t.uploadingPhotos} aria-live="polite">
                {uploads.map((upload) => (
                  <div key={upload.id} className="rounded-xl border border-border bg-surface p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{upload.name}</p>
                        <p className="text-xs font-light text-muted-foreground">{getUploadStatusLabel(upload, t, tCommon)}</p>
                      </div>
                      {upload.status === UPLOAD_STATUS.DONE && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
                      {upload.status === UPLOAD_STATUS.ERROR && <FileWarning className="h-4 w-4 text-destructive shrink-0" />}
                      {upload.status !== UPLOAD_STATUS.DONE && upload.status !== UPLOAD_STATUS.ERROR && <Clock3 className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          upload.status === UPLOAD_STATUS.DONE ? 'bg-success' : upload.status === UPLOAD_STATUS.ERROR ? 'bg-destructive' : 'bg-primary'
                        }`}
                        style={{ width: `${upload.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Gallery */}
            <div ref={galleryRef} className="mt-8 rounded-2xl border border-border bg-surface shadow-card">
              <div className="p-5 sm:p-6">
                {newPhotosAvailable && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                    <p className="text-sm font-medium text-foreground">
                      {newPhotosCount === 1 ? t.newPhotoAvailable : t.newPhotosAvailable.replace('{count}', newPhotosCount)}
                    </p>
                    <Button size="sm" className="gap-1.5 cta-primary" onClick={handleRefreshNewPhotos}>
                      <RefreshCcw className="h-3.5 w-3.5" />
                      {t.refreshGallery}
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.galleryTitle}</span>
                    <Badge variant="secondary" className="rounded-full font-mono text-[10px] bg-raised text-muted-foreground border-border">{activeEvent?.photoCount || galleryPhotos.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={galleryDownloadBusy || galleryPhotos.length === 0}
                    onClick={handleGalleryDownload}
                    className="border-border bg-raised hover:bg-elevated hover:text-foreground"
                  >
                    {galleryDownloadBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    {galleryJobPolling ? (t.preparingGalleryDownload || 'Preparing...') : (t.downloadAll || 'Download all')}
                  </Button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={photoSort === 'recent' ? 'secondary' : 'ghost'}
                    onClick={() => handleSortChange('recent')}
                    className="h-7 text-xs rounded-full"
                  >
                    {t.mostRecent || 'Most recent'}
                  </Button>
                  <Button
                    size="sm"
                    variant={photoSort === 'oldest' ? 'secondary' : 'ghost'}
                    onClick={() => handleSortChange('oldest')}
                    className="h-7 text-xs rounded-full"
                  >
                    {t.oldestFirst || 'Oldest first'}
                  </Button>
                </div>
                {unlockMessage && <p className="mt-3 text-sm font-semibold text-success">{unlockMessage}</p>}
                <div className="mt-2 space-y-2">
                  {resolveAllUpsells(eventAccess)
                    .filter((u) => ['branding', 'gallery_download'].includes(u.feature))
                    .map((upsell) => (
                      <UpsellRow
                        key={upsell.feature}
                        upsell={upsell}
                        t={t}
                        onUpgrade={() => {
                          if (typeof window !== 'undefined') {
                            window.location.href = '/pricing'
                          }
                        }}
                        checkoutBusy={false}
                        source="room_page_gallery"
                        eventSlug={activeEvent.slug}
                        eventId={activeEvent.id}
                        ownerPlan={activeEvent.ownerPlan}
                        billingTier={activeEvent.billingTier}
                        effectivePlan={eventAccess.effectivePlan}
                      />
                    ))}
                </div>
                <div className="mt-6">
                  <PhotoGalleryGrid
                    photos={galleryPhotos}
                    loading={galleryLoading}
                    error={galleryError}
                    onRetry={() => activeEvent?.slug && loadPhotos({ reset: true })}
                    onSelectPhoto={openLightbox}
                    onUploadClick={() => { heroFileInputRef.current?.click() }}
                    hasMore={hasMorePhotos}
                    onLoadMore={() => loadPhotos()}
                    loadingMore={loadingMorePhotos}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <div className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 transition-opacity duration-200 sm:hidden ${showStickyCta ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <Button size="lg" className="h-14 w-full gap-2 rounded-xl text-base font-body font-semibold cta-primary shadow-lg" aria-label={t.uploadToEvent} onClick={() => { setUploadSuccess(false); setUploadFormatError(''); trackEvent(EVENT_SNAP_CTA_CLICKED, { room_slug: activeEvent?.slug, position: 'sticky_mobile' }); cameraFileInputRef.current?.click() }}>
          <Camera className="h-5 w-5" />{t.addPhotos}
        </Button>
      </div>

      {galleryBlockedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <p className="font-display text-lg font-bold tracking-tight text-foreground">
              {isEventOwner ? t.downloadFullGalleryZip : t.fullGalleryDownloadLocked}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {isEventOwner ? t.saveAllOriginalsWithProEvent : t.hostCanUnlockGalleryDownload}
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button size="sm" className="w-full cta-primary" onClick={handleUnlockGalleryFromModal}>
                {isEventOwner ? t.unlockGalleryDownload : t.createYourOwnRoom}
              </Button>
              <Button size="sm" variant="ghost" className="w-full" onClick={() => setGalleryBlockedModalOpen(false)}>
                {tCommon.maybeLater}
              </Button>
            </div>
          </div>
        </div>
      )}

      <EventQRModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} event={activeEvent} baseUrl={baseUrl} />
      <PhotoLightbox onOpenChange={setLightboxOpen} onSelectIndex={setLightboxIndex} open={lightboxOpen} photos={galleryPhotos} selectedIndex={lightboxIndex} event={activeEvent} isOwner={isEventOwner} />
      <ToastComponent />
    </main>
  )
}
