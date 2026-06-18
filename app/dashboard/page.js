'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from '@/components/i18n-provider'
import { useRouter } from 'next/navigation'
import { upload } from '@vercel/blob/client'
import { ArrowUpDown, Camera, CheckCircle2, Copy, Download, Eye, EyeOff, FolderHeart, ImagePlus, LinkIcon, Loader2, Lock, LogOut, Pencil, Plus, QrCode, RefreshCw, Search, Share2, Sparkles, Trash2, Upload, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PhotoLightbox from '@/components/photo-lightbox'
import { EventQRModal } from '@/components/event-qr-modal'
import { trackEvent, identifyUser } from '@/lib/analytics/track-client'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import {
  EVENT_DASHBOARD_VIEWED,
  EVENT_CREATE_ROOM_CLICKED,
  EVENT_ROOM_SELECTED_IN_DASHBOARD,
  EVENT_ROOM_SHARED_FROM_DASHBOARD,
  EVENT_ROOM_QR_OPENED_FROM_DASHBOARD,
  EVENT_UPGRADE_CLICKED,
  EVENT_CHECKOUT_CANCELLED,
  EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED,
  EVENT_PRIVATE_DELIVERY_VIEWED,
  EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED,
  EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED,
  EVENT_PRIVATE_DELIVERY_DOWNLOADED,
  EVENT_PRIVATE_DELIVERY_DELETED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_COPIED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_REGENERATED,
  EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED,
  EVENT_GALLERY_DOWNLOAD_CLICKED,
  EVENT_GALLERY_DOWNLOAD_COMPLETED,
  EVENT_GALLERY_DOWNLOAD_BLOCKED,
} from '@/lib/analytics/events'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { DashboardShell } from './components/dashboard-shell'
import { DashboardSidebar } from './components/dashboard-sidebar'
import { DashboardTopBar } from './components/dashboard-top-bar'
import { DashboardHeader } from './components/dashboard-header'
import { InsightCard } from './components/insight-card'
import { EventCard } from './components/event-card'
import { EventDetailPanel } from './components/event-detail-panel'
import { DashboardPhotoCard } from './components/dashboard-photo-card'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { resolveDashboardExperience } from '@/lib/dashboard-experience'
import { EXTRA_EVENT_PRICE_LABEL } from '@/lib/pricing-config'

export default function DashboardPage() {
  const router = useRouter()

  const t = useTranslations('dashboard')
  const tCommon = useTranslations('common')
  const tPrivate = useTranslations('privateDelivery')

  const [authState, setAuthState] = useState({ loading: true, authenticated: false, email: '' })
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [events, setEvents] = useState([])
  const [selectedSlug, setSelectedSlug] = useState('')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [busy, setBusy] = useState({ auth: false, detail: false, photoId: '' })

  const handleCoverUpdated = (updatedEvent) => {
    setSelectedEvent(updatedEvent)
    setEvents((prev) => prev.map((e) => (e.slug === updatedEvent.slug ? updatedEvent : e)))
  }
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
  const [plan, setPlan] = useState('free')
  const [subscriptionCanceledAt, setSubscriptionCanceledAt] = useState(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [galleryDownloadBusy, setGalleryDownloadBusy] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [extraEventCredits, setExtraEventCredits] = useState(0)
  const [privateAssets, setPrivateAssets] = useState([])
  const [privateDeliveryLoading, setPrivateDeliveryLoading] = useState(false)
  const [privateDeliveryUploading, setPrivateDeliveryUploading] = useState(false)
  const privateDeliveryFileInputRef = useRef(null)
  const dashboardViewTracked = useRef(false)
  const [photographerLink, setPhotographerLink] = useState('')
  const [photographerLinkBusy, setPhotographerLinkBusy] = useState(false)
  const [photographerLinkCopied, setPhotographerLinkCopied] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const roomLimitTracked = useRef(false)

  useEffect(() => {
    if (createError?.limit === 'room_count' && !roomLimitTracked.current) {
      roomLimitTracked.current = true
      trackUpsellImpression({
        upsellType: 'room_limit',
        source: 'create_room_modal',
        location: 'dashboard',
        ownerPlan: plan,
        effectivePlan: plan,
        ctaPlan: 'professional',
      })
    }
  }, [createError?.limit, plan])

  const filteredEvents = useMemo(() => {
    let result = [...events]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((e) => e.name.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q))
    }
    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sortBy === 'newest' && result[0]?.createdAt) {
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    }
    return result
  }, [events, searchQuery, sortBy])

  const photos = useMemo(() => selectedEvent?.photos || [], [selectedEvent])

  const metrics = useMemo(() => {
    const eventsCount = events.length
    const totalPhotos = events.reduce((sum, e) => sum + (e.photoCount || e.photos?.length || 0), 0)
    return { eventsCount, totalPhotos }
  }, [events])

  const experience = useMemo(() => resolveDashboardExperience({ plan, events, metrics }), [plan, events, metrics])

  const canCreateRoom = useMemo(() => {
    if (!authState.authenticated) return false
    const roomCreationState = resolveEffectiveEventAccessState({ ownerPlan: plan })
    if (roomCreationState.canCreateUnlimitedRooms) return true
    const FREE_ROOM_LIMIT = 1
    return events.length < FREE_ROOM_LIMIT + extraEventCredits
  }, [authState.authenticated, plan, events.length, extraEventCredits])

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
    if (!authState.loading && !dashboardViewTracked.current) {
      dashboardViewTracked.current = true
      trackEvent(EVENT_DASHBOARD_VIEWED, {
        authenticated: authState.authenticated,
        room_count: events.length,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.loading])

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
      setMessage(error.message || t.unableToLoadSession)
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
        throw new Error(payload.error || t.authFailed)
      }
      setAuthState({ loading: false, authenticated: true, email: payload.email })
      setMessage(t.signedIn)
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
    setMessage(t.signedOut)
    router.push('/')
  }

  const loadPlan = async () => {
    try {
      const response = await fetch('/api/owner/plan', { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json()
      setPlan(payload.plan || 'free')
      setSubscriptionCanceledAt(payload.subscriptionCanceledAt || null)
      setExtraEventCredits(payload.extraEventCredits || 0)
    } catch {
      // ignore plan load errors
    }
  }

  const startCheckout = async (intent, eventId = null, entryPoint = 'dashboard', upsellType = null, upsellSource = null) => {
    if (checkoutBusy) return
    setCheckoutBusy(true)
    try {
      trackEvent(EVENT_UPGRADE_CLICKED, {
        entryPoint,
        pageType: 'dashboard',
        userRole: 'owner',
        plan: plan || 'free',
        roomCount: events.length,
        billing_intent: intent,
        event_id: eventId,
        upsell_type: upsellType,
        upsell_source: upsellSource,
      })
      const response = await fetch('/api/stripe/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, eventId, entryPoint, upsellType, upsellSource }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || t.unableToStartCheckout)
      }
      window.location.href = payload.url
    } catch (error) {
      setMessage(error.message || t.checkoutFailed)
      setCheckoutBusy(false)
    }
  }

  const loadEvents = async () => {
    try {
      const response = await fetch('/api/owner/events', { cache: 'no-store' })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(response.status >= 500 ? t.serverError : t.unableToLoadRooms)
      }
      if (!response.ok) throw new Error(payload.error || t.unableToLoadRooms)
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
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(response.status >= 500 ? t.serverError : t.unableToLoadRoomDetail)
      }
      if (!response.ok) throw new Error(payload.error || t.unableToLoadRoomDetail)
      setSelectedEvent(payload.event)
      setSelectedSlug(payload.event.slug)
      setMessage(t.viewingRoom.replace('{name}', payload.event.name))
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
      if (!response.ok) throw new Error(payload.error || t.unableToUpdatePhoto)
      setMessage(action === 'approve' ? t.photoApproved : t.photoHidden)
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
      if (!response.ok) throw new Error(payload.error || t.unableToDeletePhoto)
      setMessage(t.photoDeleted)
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
      if (!response.ok) throw new Error(payload.error || t.unableToRenameRoom)
      setSelectedEvent(payload.event)
      setMessage(t.roomRenamed)
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
      if (!response.ok) throw new Error(payload.error || t.somethingWentWrong)
      setMessage(t.roomDeleted)
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
        throw new Error(payload.error || t.signInFailed)
      }
      setAuthState({ loading: false, authenticated: true, email: payload.email })
      setMessage('')
      identifyUser(payload.email)
      await loadEvents()
    } catch (error) {
      setMessage(error.message || t.signInFailed)
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
        throw new Error(payload.error || t.somethingWentWrong)
      }
      setForgotSent(true)
      setMessage('')
    } catch (error) {
      setMessage(error.message || t.somethingWentWrong)
    } finally {
      setForgotBusy(false)
    }
  }

  const shareEvent = async (event) => {
    trackEvent(EVENT_ROOM_SHARED_FROM_DASHBOARD, { room_slug: event.slug })
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/event/${event.slug}`
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: event.name, url })
      } catch {
        // user cancelled
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setMessage(t.linkCopiedClipboard)
        setTimeout(() => setMessage(''), 2000)
      } catch {
        setMessage(t.unableToCopyLink)
      }
    } else {
      setMessage(t.sharingNotSupported)
    }
  }

  const openQR = (event) => {
    trackEvent(EVENT_ROOM_QR_OPENED_FROM_DASHBOARD, { room_slug: event.slug })
    setQrEvent(event)
    setQrOpen(true)
  }

  const handleGalleryDownload = async (event) => {
    if (!event?.slug) return
    setGalleryDownloadBusy(true)
    trackEvent(EVENT_GALLERY_DOWNLOAD_CLICKED, { room_slug: event.slug, source: 'dashboard' })
    try {
      const response = await fetch(`/api/download/gallery?eventSlug=${encodeURIComponent(event.slug)}`)
      if (response.status === 403) {
        trackEvent(EVENT_GALLERY_DOWNLOAD_BLOCKED, { room_slug: event.slug, source: 'dashboard', reason: 'free_plan' })
        alert(t.galleryDownloadLocked)
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
      const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `${event.name || event.slug}_gallery.zip`
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      trackEvent(EVENT_GALLERY_DOWNLOAD_COMPLETED, { room_slug: event.slug, source: 'dashboard', photo_count: selectedEvent?.photoCount ?? photos.length })
    } catch (err) {
      console.error('[dashboard] gallery download failed:', err)
      alert(t.galleryDownloadFailed)
    } finally {
      setGalleryDownloadBusy(false)
    }
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
      if (!response.ok) throw new Error(payload.error || t.unableToRenameRoom)
      setMessage(t.roomRenamed)
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
      if (!response.ok) throw new Error(payload.error || t.unableToSendRecovery)
      setRecoverySent(true)
    } catch (error) {
      setMessage(error.message)
      setRecoverySent(true)
    } finally {
      setRecoveryBusy(false)
    }
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateError(null)
    setCreateDialogOpen(true)
  }

  const createRoom = async () => {
    const trimmed = createName.trim()
    if (!trimmed || trimmed.length < 3) {
      setCreateError({ error: t.roomNameMinChars })
      return
    }

    if (!authState.email) {
      setCreateError({ error: t.mustBeSignedIn })
      return
    }

    trackEvent(EVENT_CREATE_ROOM_CLICKED, { page_type: 'dashboard', variant: 'modal' })

    setCreateBusy(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, ownerEmail: authState.email }),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = { error: t.serverError }
      }
      if (!response.ok) {
        setCreateError(payload)
      } else if (payload.event?.slug) {
        setCreateDialogOpen(false)
        setCreateName('')
        setCreateError(null)
        await loadEvents()
        await loadPlan()
        setSelectedSlug(payload.event.slug)
        setMessage(t.roomCreated.replace('{name}', payload.event.name))
      } else {
        setCreateError({ error: t.roomCreatedUnexpected })
      }
    } catch (e) {
      console.error('[createRoom] Error:', e)
      setCreateError({ error: e.message || t.unableToCreateRoom })
    } finally {
      setCreateBusy(false)
    }
  }

  const accountPremium = resolveEffectiveEventAccessState({ ownerPlan: plan }).isPremium

  const loadPrivateAssets = async (slug) => {
    if (!slug) return
    setPrivateDeliveryLoading(true)
    try {
      trackEvent(EVENT_PRIVATE_DELIVERY_VIEWED, { room_slug: slug })
      const response = await fetch(`/api/owner/events/${slug}/private-delivery`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        if (response.status !== 403) {
          console.error('Failed to load private delivery assets:', payload.error)
        }
        setPrivateAssets([])
        return
      }
      setPrivateAssets(payload.assets || [])
    } catch (error) {
      console.error('Error loading private delivery assets:', error)
      setPrivateAssets([])
    } finally {
      setPrivateDeliveryLoading(false)
    }
  }

  const uploadPrivateDeliveryFile = async (file) => {
    if (!selectedEvent?.slug || !file) return

    setPrivateDeliveryUploading(true)
    setMessage('')

    try {
      trackEvent(EVENT_PRIVATE_DELIVERY_UPLOAD_STARTED, { room_slug: selectedEvent.slug, file_name: file.name, file_size: file.size })

      const CHUNK_SIZE = 1024 * 1024
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

      const initResponse = await fetch(`/api/owner/events/${selectedEvent.slug}/private-delivery/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug: selectedEvent.slug,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'image/jpeg',
          totalChunks,
        }),
      })
      const initPayload = await initResponse.json()

      if (!initResponse.ok) {
        throw new Error(initPayload.error || t.unableToInitializeUpload)
      }

      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        const blob = await upload(initPayload.session.pathname || file.name, file, {
          access: 'public',
          handleUploadUrl: initPayload.session.handleUploadUrl || `/api/owner/events/${selectedEvent.slug}/private-delivery/blob`,
          clientPayload: JSON.stringify({
            eventSlug: selectedEvent.slug,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'image/jpeg',
          }),
          multipart: file.size > 5 * 1024 * 1024,
        })

        const completeResponse = await fetch(`/api/owner/events/${selectedEvent.slug}/private-delivery/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventSlug: selectedEvent.slug,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            originalName: file.name,
            mimeType: file.type || 'image/jpeg',
            size: file.size,
          }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || t.unableToFinalizeUpload)
        }

        trackEvent(EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED, { room_slug: selectedEvent.slug, asset_id: completePayload.asset?.id, file_size: file.size })
        setMessage(t.fileUploadedPrivate.replace('{name}', file.name))
        await loadPrivateAssets(selectedEvent.slug)
      } else {
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

          if (!chunkResponse.ok) {
            throw new Error(t.chunkUploadFailed)
          }
        }

        const completeResponse = await fetch(`/api/owner/events/${selectedEvent.slug}/private-delivery/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: initPayload.session.sessionId }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || t.unableToFinalizeUpload)
        }

        trackEvent(EVENT_PRIVATE_DELIVERY_UPLOAD_COMPLETED, { room_slug: selectedEvent.slug, asset_id: completePayload.asset?.id, file_size: file.size })
        setMessage(t.fileUploadedPrivate.replace('{name}', file.name))
        await loadPrivateAssets(selectedEvent.slug)
      }
    } catch (error) {
      setMessage(error.message || t.uploadFailed)
    } finally {
      setPrivateDeliveryUploading(false)
      if (privateDeliveryFileInputRef.current) {
        privateDeliveryFileInputRef.current.value = ''
      }
    }
  }

  const downloadPrivateAsset = (asset) => {
    trackEvent(EVENT_PRIVATE_DELIVERY_DOWNLOADED, { room_slug: selectedEvent?.slug, asset_id: asset.id, file_size: asset.size })
    const link = document.createElement('a')
    link.href = asset.url
    link.download = asset.originalName
    link.click()
  }

  const deletePrivateAsset = async (assetId) => {
    setBusy((c) => ({ ...c, detail: true }))
    try {
      const response = await fetch(`/api/owner/private-delivery/${assetId}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToDeleteFile)
      trackEvent(EVENT_PRIVATE_DELIVERY_DELETED, { room_slug: selectedEvent?.slug, asset_id: assetId })
      setMessage(t.fileDeletedPrivate)
      await loadPrivateAssets(selectedEvent.slug)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy((c) => ({ ...c, detail: false }))
    }
  }

  const onPrivateDeliveryFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadPrivateDeliveryFile(file)
  }

  const generatePhotographerLink = async () => {
    if (!selectedEvent) return
    setPhotographerLinkBusy(true)
    try {
      const response = await fetch(`/api/owner/events/${selectedEvent.slug}/photographer-link`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToGenerateLink)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_CREATED, { room_slug: selectedEvent.slug })
      setPhotographerLink(payload.url)
      setMessage(t.photographerLinkGenerated)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setPhotographerLinkBusy(false)
    }
  }

  const copyPhotographerLink = async () => {
    if (!photographerLink) return
    try {
      await navigator.clipboard.writeText(photographerLink)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_COPIED, { room_slug: selectedEvent?.slug })
      setPhotographerLinkCopied(true)
      setMessage(t.linkCopiedClipboard)
      setTimeout(() => setPhotographerLinkCopied(false), 2000)
    } catch {
      setMessage(t.unableToCopyLink)
    }
  }

  const revokePhotographerLink = async () => {
    if (!selectedEvent) return
    setPhotographerLinkBusy(true)
    try {
      const response = await fetch(`/api/owner/events/${selectedEvent.slug}/photographer-link`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || t.unableToRevokeLink)
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_LINK_REVOKED, { room_slug: selectedEvent.slug })
      setPhotographerLink('')
      setMessage(t.photographerLinkRevoked)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setPhotographerLinkBusy(false)
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

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
      setPhotographerLink('')
      setPhotographerLinkCopied(false)
      if (resolveEffectiveEventAccessState({ billingTier: selectedEvent?.billingTier, originalDownloadUnlocked: selectedEvent?.originalDownloadUnlocked, ownerPlan: plan }).hasPrivateDelivery) {
        loadPrivateAssets(selectedEvent.slug)
      } else {
        setPrivateAssets([])
      }
    }
  }, [selectedEvent, plan])

  useEffect(() => {
    if (!authState.authenticated) return
    loadPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState.authenticated])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const upgrade = params.get('upgrade')
    if (upgrade === 'success') {
      const intent = params.get('intent')
      if (intent === 'professional') {
        setMessage(t.welcomeProfessional)
      } else if (intent === 'high_quality_download') {
        setMessage(t.originalUnlocked)
      } else if (intent === 'extra_event') {
        setMessage(t.extraEventPurchaseSuccess)
      } else {
        setMessage(t.upgradeConfirmed)
      }
      loadPlan()
      loadEvents()
      if (selectedSlug) {
        loadEventDetail(selectedSlug)
      }
      router.replace('/dashboard', { scroll: false })
    } else if (upgrade === 'cancelled') {
      const intent = params.get('intent')
      setMessage(t.upgradeCancelled)
      if (intent === 'high_quality_download') {
        trackEvent(EVENT_ORIGINAL_DOWNLOAD_CHECKOUT_CANCELLED, {
          pageType: 'dashboard',
          userRole: 'owner',
          plan: plan || 'free',
          billing_intent: intent,
        })
      } else {
        trackEvent(EVENT_CHECKOUT_CANCELLED, {
          pageType: 'dashboard',
          userRole: 'owner',
          plan: plan || 'free',
          billing_intent: intent,
        })
      }
      router.replace('/dashboard', { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return (
    <DashboardShell
      sidebar={
        <DashboardSidebar
          experience={experience}
          email={authState.email}
          onLogout={logout}
          onUpgradeClick={
            experience.showSidebarUpsell
              ? () => startCheckout('professional', null, 'dashboard_sidebar')
              : undefined
          }
          t={t}
          tCommon={tCommon}
        />
      }
      topBar={
        <DashboardTopBar
          experience={experience}
          message={message}
          onDismissMessage={() => setMessage('')}
        />
      }
      rightPanel={
        selectedEvent ? (
          <EventDetailPanel
            event={selectedEvent}
            plan={plan}
            subscriptionCanceledAt={subscriptionCanceledAt}
            photos={photos}
            busyDetail={busy.detail}
            privateAssets={privateAssets}
            privateDeliveryLoading={privateDeliveryLoading}
            privateDeliveryUploading={privateDeliveryUploading}
            photographerLink={photographerLink}
            photographerLinkBusy={photographerLinkBusy}
            photographerLinkCopied={photographerLinkCopied}
            galleryDownloadBusy={galleryDownloadBusy}
            checkoutBusy={checkoutBusy}
            photoBusyId={busy.photoId}
            onShare={shareEvent}
            onQR={openQR}
            onGalleryDownload={handleGalleryDownload}
            onUpgradeProEvent={(upsellType) => startCheckout('pro_event', selectedEvent.id, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
            onUpgradeWeddingPro={(upsellType) => startCheckout('wedding_pro', selectedEvent.id, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
            onUpgradeProfessional={(upsellType) => startCheckout('professional', null, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
            onDelete={startDelete}
            onOpenLightbox={(index) => {
              setLightboxIndex(index)
              setLightboxOpen(true)
            }}
            onModerate={moderatePhoto}
            onPhotoDelete={deletePhoto}
            onPrivateUploadClick={() => privateDeliveryFileInputRef.current?.click()}
            onPrivateDownload={downloadPrivateAsset}
            onPrivateDelete={deletePrivateAsset}
            onGeneratePhotoLink={generatePhotographerLink}
            onCopyPhotoLink={copyPhotographerLink}
            onRevokePhotoLink={revokePhotographerLink}
            onCoverUpdated={handleCoverUpdated}
            t={t}
            tPrivate={tPrivate}
            tCommon={tCommon}
          />
        ) : null
      }
    >
      {authState.loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !authState.authenticated ? (
        <div className="mx-auto max-w-sm py-12 px-4">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
              <Lock className="h-8 w-8" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-foreground">
              {forgotMode ? t.resetYourPassword : t.signInToManage}
            </h1>
            <p className="mt-3 text-sm font-light leading-relaxed text-muted-foreground">
              {forgotMode ? t.enterEmailForReset : t.accessYourRooms}
            </p>
          </div>

          {forgotMode ? (
            <div className="surface-elevated rounded-xl p-6">
              <div className="space-y-4">
                {forgotSent ? (
                  <div className="rounded-xl border border-border bg-raised p-4 text-sm text-muted-foreground text-center">
                    {t.resetSent}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">{t.emailLabel}</label>
                      <Input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder={t.emailPlaceholder}
                        className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && forgotEmail.trim()) sendForgotLink()
                        }}
                      />
                    </div>
                    {message && <p className="text-sm text-destructive">{message}</p>}
                    <Button className="w-full h-11 cta-primary" disabled={forgotBusy || !forgotEmail.trim()} onClick={sendForgotLink}>
                      {forgotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.sendResetLink}
                    </Button>
                  </>
                )}
                <div className="text-center pt-2">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                    onClick={() => {
                      setForgotMode(false)
                      setForgotEmail('')
                      setForgotSent(false)
                      setMessage('')
                    }}
                  >
                    {t.backToSignIn}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="surface-elevated rounded-xl p-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.emailLabel}</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.emailPlaceholder}
                    className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{t.passwordLabel}</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && email.trim() && password) loginWithPassword()
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {message && <p className="text-sm text-destructive">{message}</p>}

                <Button className="w-full h-11 cta-primary" disabled={busy.auth || !email.trim() || !password} onClick={loginWithPassword}>
                  {busy.auth ? <Loader2 className="h-4 w-4 animate-spin" /> : t.signIn}
                </Button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors"
                    onClick={() => {
                      setForgotMode(true)
                      setMessage('')
                      if (email.trim()) setForgotEmail(email.trim())
                    }}
                  >
                    {t.forgotPassword}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center px-4">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-accent-dark">
            <Camera className="h-10 w-10" />
          </div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">{t.noRoomsYet}</h2>
          <p className="mt-3 max-w-sm text-sm font-light leading-relaxed text-muted-foreground">{t.noRoomsDesc}</p>
          <Button className="mt-8 cta-primary" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t.createYourRoom}
          </Button>
        </div>
      ) : (
        <div className="space-y-8 px-4 py-8 sm:px-6 lg:px-8">
          {/* Header */}
          <DashboardHeader
            experience={experience}
            t={t}
            onCreateClick={openCreateDialog}
            onSecondaryAction={
              experience?.secondaryCta === 'view_analytics'
                ? () => router.push('/dashboard/analytics')
                : undefined
            }
          />

          {/* Insight / Stats */}
          <InsightCard
            experience={experience}
            events={events}
            checkoutBusy={checkoutBusy}
            onUpgrade={() => startCheckout('professional', null, 'dashboard_banner', 'professional_account', 'dashboard_insight_card')}
            t={t}
          />

          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchRooms ?? 'Search rooms...'}
                className="h-10 rounded-lg border-input bg-surface pl-9 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-9 w-[150px] border-border bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-dark">
                  <ArrowUpDown className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder={t.sortNewest ?? 'Newest'} />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="newest">{t.sortNewest ?? 'Newest'}</SelectItem>
                  <SelectItem value="name">{t.sortName ?? 'Name'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {message && (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm text-foreground flex items-center gap-2.5 shadow-subtle">
              <CheckCircle2 className="h-4 w-4 text-accent-dark shrink-0" />
              {message}
            </div>
          )}

          {/* Event Grid */}
          <div>
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.roomsYouCreated}</span>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  plan={plan}
                  selected={selectedSlug === event.slug}
                  editing={editingSlug === event.slug}
                  editName={editName}
                  busyDetail={busy.detail}
                  onSelect={() => {
                    trackEvent(EVENT_ROOM_SELECTED_IN_DASHBOARD, {
                      room_slug: event.slug,
                      room_name: event.name,
                      photo_count: event.photoCount || event.photos?.length || 0,
                    })
                    setSelectedSlug(event.slug)
                  }}
                  onRenameStart={startRename}
                  onRenameSave={() => saveRename(event.slug)}
                  onRenameCancel={cancelRename}
                  onEditNameChange={setEditName}
                  onShare={shareEvent}
                  onQR={openQR}
                  onDelete={startDelete}
                  t={t}
                  tCommon={tCommon}
                />
              ))}
            </div>
            {filteredEvents.length === 0 && searchQuery && (
              <div className="mt-8 text-center text-sm text-muted-foreground">
                {t.noSearchResults ?? 'No rooms match your search.'}
              </div>
            )}
          </div>

          {/* Mobile / below-xl detail panel */}
          <div className="xl:hidden">
            {selectedEvent && (
              <div className="bg-surface border border-border rounded-xl shadow-subtle">
                <EventDetailPanel
                event={selectedEvent}
                plan={plan}
                subscriptionCanceledAt={subscriptionCanceledAt}
                photos={photos}
                busyDetail={busy.detail}
                privateAssets={privateAssets}
                privateDeliveryLoading={privateDeliveryLoading}
                privateDeliveryUploading={privateDeliveryUploading}
                photographerLink={photographerLink}
                photographerLinkBusy={photographerLinkBusy}
                photographerLinkCopied={photographerLinkCopied}
                galleryDownloadBusy={galleryDownloadBusy}
                checkoutBusy={checkoutBusy}
                photoBusyId={busy.photoId}
                onShare={shareEvent}
                onQR={openQR}
                onGalleryDownload={handleGalleryDownload}
                onUpgradeProEvent={(upsellType) => startCheckout('pro_event', selectedEvent.id, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
                onUpgradeWeddingPro={(upsellType) => startCheckout('wedding_pro', selectedEvent.id, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
                onUpgradeProfessional={(upsellType) => startCheckout('professional', null, 'dashboard_room_detail', upsellType, 'dashboard_event_panel')}
                onDelete={startDelete}
                onOpenLightbox={(index) => {
                  setLightboxIndex(index)
                  setLightboxOpen(true)
                }}
                onModerate={moderatePhoto}
                onPhotoDelete={deletePhoto}
                onPrivateUploadClick={() => privateDeliveryFileInputRef.current?.click()}
                onPrivateDownload={downloadPrivateAsset}
                onPrivateDelete={deletePrivateAsset}
                onGeneratePhotoLink={generatePhotographerLink}
                onCopyPhotoLink={copyPhotographerLink}
                onRevokePhotoLink={revokePhotographerLink}
                onCoverUpdated={handleCoverUpdated}
                t={t}
                tPrivate={tPrivate}
                tCommon={tCommon}
              />
              </div>
            )}
          </div>
        </div>
      )}

      <EventQRModal isOpen={qrOpen} onClose={() => setQrOpen(false)} event={qrEvent} />

      <PhotoLightbox
        onOpenChange={setLightboxOpen}
        onSelectIndex={setLightboxIndex}
        open={lightboxOpen}
        photos={photos}
        selectedIndex={lightboxIndex}
        event={selectedEvent ? { ...selectedEvent, ownerPlan: plan } : null}
        isOwner={true}
      />

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="rounded-xl shadow-xl border-border bg-surface">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-bold text-foreground">{t.createNewRoomDialog}</DialogTitle>
            <DialogDescription className="text-sm font-light text-muted-foreground">{t.createRoomDesc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t.roomNameLabel}</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t.roomNamePlaceholder}
                className="h-11 rounded-lg border-input bg-surface text-foreground placeholder:text-muted-foreground"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && createName.trim().length >= 3 && !createBusy) createRoom()
                }}
                autoFocus
              />
            </div>
            {createError?.limit === 'room_count' ? (
              <div className="space-y-3">
                {createError.extraEventCredits > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t.youHaveExtraEventsAvailable?.replace('{count}', createError.extraEventCredits) || `You have ${createError.extraEventCredits} additional event available.`}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">{t.freeLimitReachedDescWithExtra}</p>

                {/* Extra Event option */}
                <div className="space-y-2 rounded-lg border border-primary/10 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{t.extraEvent}</p>
                    <p className="text-xs font-medium text-accent-dark">{EXTRA_EVENT_PRICE_LABEL}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.oneMoreFreeEvent}</p>
                  <Button
                    className="w-full cta-primary"
                    disabled={checkoutBusy}
                    onClick={() => {
                      trackUpsellClick({
                        upsellType: 'extra_event',
                        source: 'create_room_modal',
                        location: 'dashboard',
                        ownerPlan: plan,
                        effectivePlan: plan,
                        ctaPlan: 'extra_event',
                        priceLabel: EXTRA_EVENT_PRICE_LABEL,
                      })
                      startCheckout('extra_event', null, 'dashboard_create_room_limit', 'extra_event', 'create_room_modal')
                    }}
                  >
                    {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.buyExtraEvent}
                  </Button>
                </div>

                {/* Professional option */}
                <div className="space-y-2 rounded-lg border border-border bg-raised p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{t.professional}</p>
                    <p className="text-xs font-medium text-muted-foreground">{t.professionalPrice || '€79 / month'}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.professionalUnlimitedEvents}</p>
                  <Button
                    variant="outline"
                    className="w-full border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground"
                    disabled={checkoutBusy}
                    onClick={() => {
                      trackUpsellClick({
                        upsellType: 'room_limit',
                        source: 'create_room_modal',
                        location: 'dashboard',
                        ownerPlan: plan,
                        effectivePlan: plan,
                        ctaPlan: 'professional',
                      })
                      startCheckout('professional', null, 'dashboard_create_room_limit', 'room_limit', 'create_room_modal')
                    }}
                  >
                    {checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.startProfessional}
                  </Button>
                </div>
              </div>
            ) : createError?.error ? (
              <p className="text-sm text-destructive">{createError.error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)} className="text-muted-foreground hover:text-foreground">
              {tCommon.cancel}
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button
                className="cta-primary"
                disabled={createBusy || !createName.trim() || createName.trim().length < 3 || !canCreateRoom}
                onClick={createRoom}
              >
                {createBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.createRoomBtn}
              </Button>
              {createError?.limit === 'room_count' && !canCreateRoom && (
                <p className="text-xs text-muted-foreground">{t.buyExtraEventOrStartProfessional}</p>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="rounded-xl shadow-xl border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-bold text-foreground">{t.deleteRoomTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-light text-muted-foreground">
              {t.deleteRoomWarning} <strong className="text-foreground">{selectedEvent?.name}</strong> {t.deleteRoomAnd} {selectedEvent?.photoCount ?? selectedEvent?.photos?.length ?? 0} {t.deleteRoomPhotos}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)} className="border-border bg-raised text-foreground hover:bg-elevated hover:text-foreground">
              {tCommon.cancel}
            </AlertDialogCancel>
            <AlertDialogAction onClick={deleteEvent} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {tCommon.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden file input for private delivery */}
      <input ref={privateDeliveryFileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={onPrivateDeliveryFileSelect} />
    </DashboardShell>
  )
}
