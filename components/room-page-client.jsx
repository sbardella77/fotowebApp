'use client'

import { upload } from '@vercel/blob/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  Download,
  ImagePlus,
  Images,
  LayoutDashboard,
  Loader2,
  PartyPopper,
  RefreshCcw,
  Upload,
  Users,
  WifiOff,
  FileWarning,
  ArrowDown,
} from 'lucide-react'
import PhotoGalleryGrid from '@/components/photo-gallery-grid'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
import { SnapRoomsIcon } from '@/components/marketing/logo'
import { getSortedRenderablePhotos, getRenderablePhotos } from '@/lib/photo-utils'
import { optimizeImage } from '@/lib/client-image-optimizer'
import { runWithConcurrency, isRetryableUploadHttpStatus, waitForOnline } from '@/lib/upload-utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { trackEvent } from '@/lib/analytics/track-client'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import {
  EVENT_ROOM_VIEWED,
  EVENT_UPLOAD_CTA_CLICKED,
  EVENT_PHOTOS_SELECTED,
  EVENT_UPLOAD_STARTED,
  EVENT_UPLOAD_COMPLETED,
  EVENT_SECOND_UPLOAD_COMPLETED,
  EVENT_UPLOAD_FILE_REJECTED,
  EVENT_GUEST_UPLOAD_OPTIMIZED,
  EVENT_UPLOAD_FAILED,
  EVENT_MOMENT_SELECTED,
  EVENT_GUEST_NAME_ENTERED,
  EVENT_WHATSAPP_SHARE_CLICKED,
  EVENT_NATIVE_SHARE_CLICKED,
  EVENT_COPY_LINK_CLICKED,
  EVENT_QR_OPENED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED,
  EVENT_GALLERY_DOWNLOAD_CLICKED,
  EVENT_GALLERY_DOWNLOAD_COMPLETED,
  EVENT_GALLERY_DOWNLOAD_BLOCKED,
} from '@/lib/analytics/events'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { LanguageSwitcher } from '@/components/language-switcher'
import { InstallCta } from '@/components/install-cta'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { resolveAllUpsells } from '@/lib/upsell-context'
import { UpsellRow } from '@/components/upsell-row'
import { useToast } from '@/lib/hooks/use-toast'
import { RoomNotFound } from '@/components/room/room-not-found'
import { NewRoomShareBanner } from '@/components/room/new-room-share-banner'
import { UPLOAD_STATUS, UploadProgressList } from '@/components/room/upload-progress-list'
import { ShareButtonsRow } from '@/components/room/share-buttons-row'
import { ShareEventCard } from '@/components/room/share-event-card'
import { ViralShareSection } from '@/components/room/viral-share-section'
import { StickyUploadCta } from '@/components/room/sticky-upload-cta'
import { GalleryBlockedModal } from '@/components/room/gallery-blocked-modal'

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

function dedupePhotosById(photos) {
  const seen = new Set()
  return photos.filter((p) => {
    if (!p?.id || seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

export default function RoomPageClient({ slug, isNew }) {
  const t = useTranslations('room')
  const tCommon = useTranslations('common')
  const locale = useLocale()
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
  const [selectedMomentSlug, setSelectedMomentSlug] = useState('all')
  const [pendingFiles, setPendingFiles] = useState([])
  const [pendingMomentId, setPendingMomentId] = useState('')
  const [guestNameOpen, setGuestNameOpen] = useState(false)
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
  // Remembers which CTA opened the native picker (hero/sticky/upload_more/
  // gallery_empty_state) so it can be attached to analytics events that fire
  // after the picker returns, when the click that triggered it is no longer
  // in scope.
  const lastCtaSourceRef = useRef('')
  const heroRef = useRef(null)
  const galleryRef = useRef(null)
  const roomViewTracked = useRef(false)
  const uploadCompletedTracked = useRef(false)
  // localId -> { file, optimizedFile, momentId } for files currently shown
  // with status ERROR in `uploads`, so a manual retry can re-run the exact
  // same upload without asking the guest to re-pick from their gallery.
  // Entries are removed once that file's upload finally succeeds (whether
  // via auto-retry or a manual retry click).
  const pendingFilesRef = useRef(new Map())
  const guestNameTracked = useRef(false)
  const { showToast, ToastComponent } = useToast()
  const fetchControllerRef = useRef(null)
  const photosControllerRef = useRef(null)
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

  useEffect(() => {
    return () => {
      pendingFilesRef.current.clear()
    }
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
        // activeEvent/isEventOwner haven't re-rendered from the setActiveEvent
        // call above yet, so host status is derived from payload.event
        // directly here rather than from the (still stale) isEventOwner memo.
        const viewedIsHost = Boolean(
          ownerSession?.authenticated &&
          payload.event?.ownerEmail &&
          ownerSession.email.toLowerCase() === payload.event.ownerEmail.toLowerCase()
        )
        const viewedMoments = payload.event?.moments || []
        trackEvent(EVENT_ROOM_VIEWED, {
          room_slug: payload.event?.slug, room_name: payload.event?.name,
          is_new_room: isNew, photo_count: payload.event?.photos?.length || 0,
          is_host: viewedIsHost,
          has_moments: viewedMoments.length > 0,
          moment_count: viewedMoments.length,
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

  const MAX_UPLOAD_ATTEMPTS = 5

  const uploadSingleFile = async (file, optimizedFile, momentId) => {
    if (!activeEvent?.slug) return false
    const localId = `${file.name}-${file.lastModified}`
    const fileToUpload = optimizedFile || file
    pendingFilesRef.current.set(localId, { file, optimizedFile, momentId })

    setUploads((current) => {
      if (current.some((u) => u.id === localId)) {
        return current.map((u) =>
          u.id === localId
            ? { ...u, size: fileToUpload.size, status: UPLOAD_STATUS.QUEUED, detail: t.preparingUpload, errorMessage: '' }
            : u
        )
      }
      return [
        { id: localId, name: file.name, size: fileToUpload.size, progress: 2, status: UPLOAD_STATUS.QUEUED, detail: t.preparingUpload, errorMessage: '' },
        ...current,
      ]
    })

    const updateUpload = (next) => {
      setUploads((current) => current.map((item) => (item.id === localId ? { ...item, ...next } : item)))
    }

    const isRetryable = (error) => {
      if (error.nonRetryable) return false
      return true
    }

    const totalChunks = Math.ceil(fileToUpload.size / CHUNK_SIZE)
    // Only meaningful for the local chunked path below — a session opened
    // there is reused across outer retry attempts (so a network blip
    // resumes from the next unsent chunk instead of discarding every chunk
    // the server already has). The Vercel Blob path never persists a
    // session across attempts: it re-inits fresh each retry, unchanged
    // from before, since resuming its own multipart protocol isn't
    // something this change touches.
    let chunkSession = null
    let nextChunkIndex = 0

    // Defined once (not inside the retry loop) so it closes over the
    // mutable chunkSession/nextChunkIndex above and both reads and
    // advances the SAME counters across outer attempts.
    const uploadRemainingLocalChunks = async () => {
      updateUpload({ progress: 8, status: UPLOAD_STATUS.UPLOADING })
      for (let chunkIndex = nextChunkIndex; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, fileToUpload.size)
        const chunkBlob = fileToUpload.slice(start, end)

        const CHUNK_MAX_ATTEMPTS = 3
        for (let chunkAttempt = 0; ; chunkAttempt += 1) {
          try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              updateUpload({ status: UPLOAD_STATUS.UPLOADING, detail: t.waitingForConnection || 'Waiting for connection…' })
              await waitForOnline()
            }
            const formData = new FormData()
            formData.append('sessionId', chunkSession.sessionId)
            formData.append('uploadToken', chunkSession.uploadToken)
            formData.append('chunkIndex', String(chunkIndex))
            formData.append('totalChunks', String(totalChunks))
            formData.append('chunk', chunkBlob, `${fileToUpload.name}.part-${chunkIndex}`)
            const chunkResponse = await fetch('/api/uploads/chunk', { method: 'POST', body: formData })
            const chunkPayload = await chunkResponse.json()
            if (!chunkResponse.ok) {
              const err = new Error(chunkPayload.error || t.chunkFailed)
              if (chunkResponse.status === 400 || chunkResponse.status === 403) {
                // Session gone/invalid server-side — no point retrying more
                // chunks against it; force a fresh init instead.
                err.sessionInvalid = true
              }
              if (!isRetryableUploadHttpStatus(chunkResponse.status)) err.nonRetryable = true
              throw err
            }
            nextChunkIndex = chunkIndex + 1
            break
          } catch (chunkError) {
            if (chunkError.nonRetryable || chunkError.sessionInvalid || chunkAttempt >= CHUNK_MAX_ATTEMPTS - 1) {
              throw chunkError
            }
            await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** chunkAttempt, 4000)))
          }
        }

        updateUpload({
          progress: 10 + Math.round((nextChunkIndex / totalChunks) * 75),
          status: UPLOAD_STATUS.UPLOADING,
          detail: `${t.uploadedChunks} ${nextChunkIndex}/${totalChunks}`,
        })
      }

      const completeResponse = await fetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: chunkSession.sessionId, uploadToken: chunkSession.uploadToken, uploaderName: guestName, caption: '', momentId: momentId || undefined }),
      })
      const completePayload = await completeResponse.json()
      if (!completeResponse.ok) {
        if (completePayload.limit === 'photo_count') {
          setPhotoLimitError(completePayload)
          updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached })
          const err = new Error('photo_limit')
          err.nonRetryable = true
          throw err
        }
        const err = new Error(completePayload.error || t.uploadError)
        if (completeResponse.status === 403) err.sessionInvalid = true
        if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true
        throw err
      }
      updateUpload({ progress: 100, status: UPLOAD_STATUS.DONE })
      setActiveEvent(completePayload.event)
      setGalleryError('')
    }

    let lastError
    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++) {
      try {
        // Never burn an attempt against a connection we already know is
        // down — wait for it to come back (or a generous timeout) first.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          updateUpload({ status: UPLOAD_STATUS.UPLOADING, detail: t.waitingForConnection || 'Waiting for connection…' })
          await waitForOnline()
        }

        if (attempt > 0) {
          updateUpload({
            progress: 5,
            status: UPLOAD_STATUS.UPLOADING,
            detail: `${t.uploadingPhotos} (${tCommon.retry} ${attempt}/${MAX_UPLOAD_ATTEMPTS - 1})`,
          })
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)))
        }

        // Resuming an already-open local-chunk session from a previous
        // attempt: skip straight to uploading the remaining chunks.
        if (chunkSession) {
          await uploadRemainingLocalChunks()
          pendingFilesRef.current.delete(localId)
          return true
        }

        const initResponse = await fetch('/api/uploads/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventSlug: activeEvent.slug,
            fileName: fileToUpload.name,
            fileSize: fileToUpload.size,
            mimeType: fileToUpload.type || 'image/jpeg',
            totalChunks,
            uploaderName: guestName,
            caption: '',
            momentId: momentId || undefined,
          }),
        })
        const initPayload = await initResponse.json()
        if (!initResponse.ok) {
          if (initPayload.limit === 'photo_count') {
            setPhotoLimitError(initPayload)
            updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached })
            const err = new Error('photo_limit')
            err.nonRetryable = true
            throw err
          }
          const err = new Error(initPayload.error || t.uploadError)
          if (!isRetryableUploadHttpStatus(initResponse.status)) err.nonRetryable = true
          throw err
        }

        if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
          updateUpload({ progress: 8, status: UPLOAD_STATUS.UPLOADING, detail: t.uploading + ' ' + t.galleryTitle })
          const session = initPayload.session
          await upload(
            session.pathname,
            fileToUpload,
            {
              access: 'public',
              handleUploadUrl: session.handleUploadUrl,
              clientPayload: JSON.stringify({
                sessionId: session.sessionId,
              }),
              multipart: fileToUpload.size > 5 * 1024 * 1024,
              onUploadProgress: ({ percentage }) => {
                updateUpload({
                  progress: 10 + Math.round((percentage / 100) * 75),
                  status: UPLOAD_STATUS.UPLOADING,
                  detail: `${t.uploadedPercent} ${Math.round(percentage)}%`,
                })
              },
            }
          )
          updateUpload({ progress: 90, status: UPLOAD_STATUS.UPLOADING, detail: t.finalizingGallery })
          const completeResponse = await fetch('/api/uploads/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: session.sessionId,
            }),
          })
          const completePayload = await completeResponse.json()
          if (!completeResponse.ok) {
            if (completePayload.limit === 'photo_count') {
              setPhotoLimitError(completePayload)
              updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: t.roomPhotoLimitReached })
              const err = new Error('photo_limit')
              err.nonRetryable = true
              throw err
            }
            const err = new Error(completePayload.error || t.uploadError)
            if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true
            throw err
          }
          updateUpload({ progress: 100, status: UPLOAD_STATUS.DONE })
          setActiveEvent(completePayload.event)
          setGalleryError('')
          pendingFilesRef.current.delete(localId)
          return true
        }

        // ── Local chunked path (dev / non-Vercel-Blob storage only) ──────
        chunkSession = initPayload.session
        nextChunkIndex = 0
        await uploadRemainingLocalChunks()
        pendingFilesRef.current.delete(localId)
        return true
      } catch (error) {
        lastError = error
        if (error.sessionInvalid) {
          chunkSession = null
          nextChunkIndex = 0
        }
        if (!isRetryable(error)) break
      }
    }

    console.error('Upload failed after retries', lastError)
    updateUpload({ status: UPLOAD_STATUS.ERROR, errorMessage: tCommon.failed })
    return false
  }

  const retryUpload = (localId) => {
    const pending = pendingFilesRef.current.get(localId)
    if (!pending) return
    uploadSingleFile(pending.file, pending.optimizedFile, pending.momentId)
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

    const eventMoments = activeEvent?.moments || []
    trackEvent(EVENT_PHOTOS_SELECTED, {
      room_slug: activeEvent?.slug,
      photo_count: supportedFiles.length,
      has_moments: eventMoments.length > 0,
      moment_count: eventMoments.length,
      is_host: isEventOwner,
      source: lastCtaSourceRef.current,
    })

    if (eventMoments.length > 1) {
      // Multiple moments: defer the choice until after photo selection
      // instead of forcing it upfront — the guest picks files first, then
      // (optionally) tags the batch before confirming the upload.
      setPendingMomentId('')
      setPendingFiles(supportedFiles)
      return
    }
    await beginUpload(supportedFiles, eventMoments[0]?.id ?? '')
  }

  const beginUpload = async (filesToUpload, momentId) => {
    setIsUploading(true); setLastUploadCount(filesToUpload.length)
    const eventMoments = activeEvent?.moments || []
    const funnelProps = {
      has_moments: eventMoments.length > 0,
      moment_count: eventMoments.length,
      is_host: isEventOwner,
      source: lastCtaSourceRef.current,
    }
    trackEvent(EVENT_UPLOAD_STARTED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, is_second_upload: uploadCompletedTracked.current, ...funnelProps })

    // Pre-register upload entries with optimizing status
    setUploads(
      filesToUpload.map((file) => ({
        id: `${file.name}-${file.lastModified}`,
        name: file.name,
        size: file.size,
        progress: 2,
        status: UPLOAD_STATUS.QUEUED,
        detail: t.optimizingPhotos,
        errorMessage: '',
      }))
    )

    // Optimize all files concurrently
    const optimizeStart = performance.now()
    const optimizedMap = new Map()
    const optimizationResults = []
    await Promise.all(
      filesToUpload.map(async (file) => {
        const result = await optimizeImage(file)
        const localId = `${file.name}-${file.lastModified}`
        optimizedMap.set(localId, result.file)
        optimizationResults.push(result)
        setUploads((current) =>
          current.map((u) =>
            u.id === localId ? { ...u, size: result.file.size, detail: t.preparingUpload } : u
          )
        )
      })
    )
    const optimizeEnd = performance.now()
    const durationMs = Math.round(optimizeEnd - optimizeStart)

    let originalBytes = 0
    let optimizedBytes = 0
    let optimizedFiles = 0
    let skippedFiles = 0

    for (const r of optimizationResults) {
      originalBytes += r.originalBytes
      optimizedBytes += r.optimizedBytes
      if (r.optimized) optimizedFiles++
      else skippedFiles++
    }

    const savedBytes = originalBytes - optimizedBytes
    const savedPercent = originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0

    try {
      trackEvent(EVENT_GUEST_UPLOAD_OPTIMIZED, {
        files: filesToUpload.length,
        optimized_files: optimizedFiles,
        skipped_files: skippedFiles,
        original_bytes: originalBytes,
        optimized_bytes: optimizedBytes,
        saved_bytes: savedBytes,
        saved_percent: savedPercent,
        duration_ms: durationMs,
        room_slug: activeEvent?.slug,
        locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
        connection_type: typeof navigator !== 'undefined' && navigator.connection?.effectiveType ? navigator.connection.effectiveType : undefined,
        is_mobile_viewport: typeof window !== 'undefined' ? window.innerWidth < 640 : undefined,
      })
    } catch {
      // silently ignore
    }

    // Upload with controlled concurrency (max 3)
    const tasks = filesToUpload.map((file) => async () => {
      const localId = `${file.name}-${file.lastModified}`
      const optimized = optimizedMap.get(localId)
      return uploadSingleFile(file, optimized, momentId)
    })
    const results = await runWithConcurrency(tasks, 3)

    const allSucceeded = results.every(Boolean)
    setIsUploading(false)
    if (allSucceeded) {
      setUploadSuccess(true)
      setUploads([])
      setShowViralSection(true); showToast(t.uploadSuccess)
      if (uploadCompletedTracked.current) { trackEvent(EVENT_SECOND_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, ...funnelProps }) }
      else { uploadCompletedTracked.current = true; trackEvent(EVENT_UPLOAD_COMPLETED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, ...funnelProps }) }
      await refreshGalleryAfterUpload()
      lastLocalUploadAt.current = Date.now()
    } else {
      const someSucceeded = results.some(Boolean)
      setUploadSuccess(false)
      trackEvent(EVENT_UPLOAD_FAILED, { room_slug: activeEvent?.slug, batch_size: filesToUpload.length, partial: someSucceeded, ...funnelProps })
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
  }

  const openLightbox = (index) => { setLightboxIndex(index); setLightboxOpen(true) }

  const [galleryDownloadBusy, setGalleryDownloadBusy] = useState(false)

  const loadPhotos = async ({ reset = false, sortOverride, momentOverride } = {}) => {
    if (!activeEvent?.slug) return
    const targetSort = sortOverride || photoSort
    const targetMoment = momentOverride !== undefined ? momentOverride : selectedMomentSlug
    const cursor = reset ? null : photoCursor
    // Abort previous fetch to avoid race conditions
    if (photosControllerRef.current) {
      photosControllerRef.current.abort()
    }
    const controller = new AbortController()
    photosControllerRef.current = controller
    setLoadingMorePhotos(true)
    setGalleryError('')
    try {
      const url = new URL(`/api/events/${activeEvent.slug}/photos`, window.location.origin)
      if (cursor) url.searchParams.set('cursor', cursor)
      url.searchParams.set('sort', targetSort)
      if (targetMoment && targetMoment !== 'all') url.searchParams.set('moment', targetMoment)
      const response = await fetch(url.toString(), { cache: 'no-store', signal: controller.signal })
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
      if (error.name === 'AbortError') {
        return
      }
      console.error('[room] loadPhotos error:', error)
      setGalleryError(error.message || t.unableToLoadGallery)
    } finally {
      if (photosControllerRef.current === controller) {
        setLoadingMorePhotos(false)
      }
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
      if (selectedMomentSlug && selectedMomentSlug !== 'all') url.searchParams.set('moment', selectedMomentSlug)
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

  const handleMomentChange = (newMoment) => {
    if (newMoment === selectedMomentSlug) return
    setSelectedMomentSlug(newMoment)
    setPhotos([])
    setPhotoCursor(null)
    setHasMorePhotos(false)
    loadPhotos({ reset: true, momentOverride: newMoment })
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

    // Galleries above the sync limit: full export is temporarily unavailable.
    // No async job is created or polled (the server refuses it too).
    showToast(t.galleryLargeDownloadUnavailable || 'Downloading the full gallery is temporarily unavailable for very large galleries.', 'error')
    setGalleryDownloadBusy(false)
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
              <SnapRoomsIcon className="h-9 w-9 shrink-0" />
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
            <SnapRoomsIcon className="h-9 w-9 shrink-0" />
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
          <SnapRoomsIcon className="h-14 w-14" />
          <p className="text-lg font-light text-foreground">{t.loading}</p>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <section className="container relative z-10 px-4 py-8 pb-28 sm:pb-20">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Event cover hero */}
            <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
              {activeEvent.coverUrl ? (
                <div className="relative h-56 sm:h-72 md:h-80 w-full overflow-hidden">
                  <img
                    src={activeEvent.coverUrl}
                    alt={activeEvent.name}
                    className="h-full w-full object-cover"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
                    <span className="inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/90 backdrop-blur-md">{t.roomLabel}</span>
                    <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">{activeEvent.name}</h1>
                    <p className="mt-1 text-sm font-light text-white/85">{activeEvent?.photoCount || galleryPhotos.length} {t.photosLabel}</p>
                  </div>
                </div>
              ) : (
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomLabel}</span>
                      <h1 className="mt-1.5 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">{activeEvent.name}</h1>
                      <p className="mt-1 text-sm font-light text-muted-foreground">{activeEvent?.photoCount || galleryPhotos.length} {t.photosLabel}</p>
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
                </div>
                {/* Copy link / share / QR are host-only up here — guests reach the same
                    actions from the secondary "Share this event" card further down. */}
                {isEventOwner && (
                  <div className="mt-4">
                    <ShareButtonsRow
                      event={activeEvent}
                      baseUrl={baseUrl}
                      t={t}
                      tCommon={tCommon}
                      copied={copied}
                      setCopied={setCopied}
                      showToast={showToast}
                      onShowQR={() => setQrModalOpen(true)}
                      source="room_info_card"
                    />
                  </div>
                )}
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
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-foreground">1</span>{t.step1ChoosePhotos}</span>
                    <span className="hidden sm:block h-px w-4 bg-border" />
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-foreground">2</span>{t.step2Upload}</span>
                    <span className="hidden sm:block h-px w-4 bg-border" />
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-foreground">3</span>{t.step3Enjoy}</span>
                  </div>
                )}

                <div className="mt-6 mx-auto max-w-sm">
                  <Collapsible open={guestNameOpen} onOpenChange={setGuestNameOpen}>
                    {!guestNameOpen && (
                      <CollapsibleTrigger asChild>
                        <button type="button" className="flex w-full flex-col items-center gap-0.5 text-center motion-reduce:transition-none">
                          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{t.optionalLabel}</span>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary">
                            {t.addYourName}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      </CollapsibleTrigger>
                    )}
                    <CollapsibleContent>
                      <div className="space-y-2 text-left">
                        <label htmlFor="guest-name" className="text-sm font-medium text-foreground">{t.guestNamePlaceholder}</label>
                        <Input
                          id="guest-name"
                          value={guestName}
                          onChange={(event) => {
                            const value = event.target.value
                            setGuestName(value)
                            if (value.trim() && !guestNameTracked.current) {
                              guestNameTracked.current = true
                              trackEvent(EVENT_GUEST_NAME_ENTERED, { room_slug: activeEvent?.slug })
                            }
                          }}
                          placeholder={t.yourName}
                          className="h-11 rounded-xl border-border bg-raised text-foreground placeholder:text-muted-foreground"
                          autoFocus
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
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
                      <Button size="sm" className="cta-primary" onClick={() => { lastCtaSourceRef.current = 'upload_more'; heroFileInputRef.current?.click() }}>
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
                          <Button size="sm" className="cta-primary" asChild><a href={localizedPath(locale, '/pricing')}>{tCommon.viewPricing}</a></Button>
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
                ) : pendingFiles.length > 0 ? (
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {(t.photosSelectedCount || '{count} photos selected').replace('{count}', pendingFiles.length)}
                    </p>
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-xs font-light text-muted-foreground">{t.whereDoThesePhotosBelong || 'Where do these photos belong?'}</span>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { setPendingMomentId(''); trackEvent(EVENT_MOMENT_SELECTED, { room_slug: activeEvent?.slug, moment_id: null }) }}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            !pendingMomentId
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-raised text-muted-foreground hover:bg-elevated hover:text-foreground'
                          }`}
                          aria-pressed={!pendingMomentId}
                        >
                          {t.noMoment || 'No moment'}
                        </button>
                        {activeEvent.moments.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => { setPendingMomentId(m.id); trackEvent(EVENT_MOMENT_SELECTED, { room_slug: activeEvent?.slug, moment_id: m.id }) }}
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                              pendingMomentId === m.id
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-raised text-muted-foreground hover:bg-elevated hover:text-foreground'
                            }`}
                            aria-pressed={pendingMomentId === m.id}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                      <Button
                        size="lg"
                        className="h-14 gap-2 rounded-xl px-8 text-base font-body font-semibold cta-primary touch-target"
                        disabled={Boolean(photoLimitError)}
                        onClick={() => {
                          const files = pendingFiles
                          const momentId = pendingMomentId
                          setPendingFiles([])
                          setPendingMomentId('')
                          beginUpload(files, momentId)
                        }}
                      >
                        <Upload className="h-5 w-5" />
                        {(t.uploadPhotosCount || 'Upload {count} photos').replace('{count}', pendingFiles.length)}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => { setPendingFiles([]); setPendingMomentId('') }}>
                        {t.changePhotos || 'Choose different photos'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <Button
                      size="lg"
                      className="h-14 w-full gap-2 rounded-xl px-8 text-base font-body font-semibold cta-primary touch-target sm:w-auto"
                      disabled={Boolean(photoLimitError)}
                      aria-label={t.addPhotos}
                      onClick={() => { setUploadSuccess(false); setUploadFormatError(''); lastCtaSourceRef.current = 'hero'; trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug, source: 'hero', is_host: isEventOwner, has_moments: (activeEvent?.moments?.length || 0) > 0, moment_count: activeEvent?.moments?.length || 0 }); heroFileInputRef.current?.click() }}
                    >
                      <ImagePlus className="h-5 w-5" />{t.addPhotos}
                    </Button>
                    {galleryPhotos.length > 0 && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground motion-reduce:transition-none"
                        onClick={() => galleryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      >
                        {t.viewGallery}<ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                <p className="mt-5 text-xs font-light text-muted-foreground">{t.noAppNeeded}</p>
              </div>
            </div>

            <input ref={heroFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={onFilesSelected} aria-label={t.addPhotos} />

            <UploadProgressList uploads={uploads} onRetry={retryUpload} canRetry={(id) => pendingFilesRef.current.has(id)} t={t} tCommon={tCommon} />

            {/* Latest photos — right after the primary action, for social proof */}
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
                    {t.downloadAll || 'Download all'}
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
                {activeEvent?.moments && activeEvent.moments.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleMomentChange('all')}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selectedMomentSlug === 'all'
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-raised text-muted-foreground hover:bg-elevated hover:text-foreground'
                      }`}
                      aria-pressed={selectedMomentSlug === 'all'}
                    >
                      {t.allPhotos || 'All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMomentChange('unassigned')}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selectedMomentSlug === 'unassigned'
                          ? 'bg-secondary text-secondary-foreground'
                          : 'bg-raised text-muted-foreground hover:bg-elevated hover:text-foreground'
                      }`}
                      aria-pressed={selectedMomentSlug === 'unassigned'}
                    >
                      {t.unassignedPhotos || 'Unassigned'}
                    </button>
                    {activeEvent.moments.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleMomentChange(m.slug)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors truncate max-w-[140px] ${
                          selectedMomentSlug === m.slug
                            ? 'bg-secondary text-secondary-foreground'
                            : 'bg-raised text-muted-foreground hover:bg-elevated hover:text-foreground'
                        }`}
                        aria-pressed={selectedMomentSlug === m.slug}
                        title={m.name}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
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
                            window.location.href = localizedPath(locale, '/pricing')
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
                    onUploadClick={() => { lastCtaSourceRef.current = 'gallery_empty_state'; heroFileInputRef.current?.click() }}
                    hasMore={hasMorePhotos}
                    onLoadMore={() => loadPhotos()}
                    loadingMore={loadingMorePhotos}
                  />
                </div>
              </div>
            </div>

            {/* Viral share — celebratory prompt right after a successful upload */}
            {showViralSection && (
              <ViralShareSection
                event={activeEvent}
                baseUrl={baseUrl}
                t={t}
                showToast={showToast}
                onDismiss={() => setShowViralSection(false)}
                onShowQR={() => setQrModalOpen(true)}
              />
            )}

            {isNew && !newRoomBannerDismissed && (
              <NewRoomShareBanner event={activeEvent} baseUrl={baseUrl} onDismiss={() => setNewRoomBannerDismissed(true)} showToast={showToast} onShowQR={() => { trackEvent(EVENT_QR_OPENED, { room_slug: activeEvent?.slug, source: 'new_room_banner' }); setQrModalOpen(true) }} />
            )}

            <InstallCta mode="room" className="mt-2" />

            {/* Share this event — secondary for guests, always reachable */}
            <ShareEventCard
              event={activeEvent}
              baseUrl={baseUrl}
              t={t}
              tCommon={tCommon}
              copied={copied}
              setCopied={setCopied}
              showToast={showToast}
              onShowQR={() => setQrModalOpen(true)}
            />
          </div>
        </section>
      )}

      {/* Sticky mobile CTA */}
      <StickyUploadCta
        visible={showStickyCta}
        t={t}
        onClick={() => { setUploadSuccess(false); setUploadFormatError(''); lastCtaSourceRef.current = 'sticky'; trackEvent(EVENT_UPLOAD_CTA_CLICKED, { room_slug: activeEvent?.slug, source: 'sticky', is_host: isEventOwner, has_moments: (activeEvent?.moments?.length || 0) > 0, moment_count: activeEvent?.moments?.length || 0 }); heroFileInputRef.current?.click() }}
      />

      {galleryBlockedModalOpen && (
        <GalleryBlockedModal
          isEventOwner={isEventOwner}
          t={t}
          tCommon={tCommon}
          onUnlock={handleUnlockGalleryFromModal}
          onClose={() => setGalleryBlockedModalOpen(false)}
        />
      )}

      <EventQRModal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} event={activeEvent} baseUrl={baseUrl} />
      <PhotoLightbox onOpenChange={setLightboxOpen} onSelectIndex={setLightboxIndex} open={lightboxOpen} photos={galleryPhotos} selectedIndex={lightboxIndex} event={activeEvent} isOwner={isEventOwner} />
      <ToastComponent />
    </main>
  )
}
