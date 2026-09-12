'use client'

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Loader2,
  X,
  Lock,
  Check,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent } from '@/lib/analytics/track-client'
import { csrfFetch } from '@/lib/client/csrf-fetch'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import {
  EVENT_DOWNLOAD_QUALITY_SELECTED,
  EVENT_ORIGINAL_DOWNLOAD_UNLOCK_CLICKED,
  EVENT_BRANDED_PHOTO_DOWNLOADED,
  EVENT_GALLERY_DOWNLOAD_CLICKED,
  EVENT_GALLERY_DOWNLOAD_BLOCKED,
  EVENT_ORIGINAL_QUALITY_PAYWALL_VIEWED,
  EVENT_ORIGINAL_QUALITY_UNLOCK_CLICKED,
} from '@/lib/analytics/events'

const SWIPE_THRESHOLD = 50
const SWIPE_VELOCITY = 0.5

const ImageWithLoading = ({ src, alt }) => {
  const [status, setStatus] = useState('loading')
  const t = useTranslations('room')

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-foreground/40" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-2 text-foreground/40">
          <ImageOff className="h-10 w-10" />
          <span className="text-sm">{t.failedToLoadImage}</span>
        </div>
      )}
      <img
        alt={alt}
        className={`max-h-full max-w-full object-contain transition-opacity duration-300 ${
          status === 'loaded' ? 'opacity-100' : 'opacity-0'
        }`}
        decoding="async"
        src={src}
        onError={() => setStatus('error')}
        onLoad={() => setStatus('loaded')}
      />
    </div>
  )
}

const PhotoLightbox = ({
  open,
  onOpenChange,
  photos = [],
  selectedIndex = 0,
  onSelectIndex,
  event = null,
  isOwner = false,
  className = '',
}) => {
  // Photos are already filtered/normalized once by the parent (getRenderablePhotos).
  // selectedIndex refers to that same list, so the lightbox must not re-filter it.
  const photo = photos[selectedIndex] || null
  const t = useTranslations('room')
  const [isClosing, setIsClosing] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [unlockModalOpen, setUnlockModalOpen] = useState(false)

  // Touch handling refs
  const touchStart = useRef({ x: 0, y: 0, time: 0 })
  const touchEnd = useRef({ x: 0, y: 0, time: 0 })
  const isSwiping = useRef(false)
  const containerRef = useRef(null)

  const access = resolveEffectiveEventAccessState({
    billingTier: event?.billingTier,
    originalDownloadUnlocked: event?.originalDownloadUnlocked,
    ownerPlan: event?.ownerPlan,
  })
  const canDownloadOriginal = access.canDownloadOriginal
  const isFreeRoom = access.isFree

  useEffect(() => {
    if (open && isOwner && !canDownloadOriginal && event?.slug) {
      trackUpsellImpression({
        upsellType: 'original_quality_unlock',
        source: 'lightbox_download_menu',
        eventSlug: event.slug,
        eventId: event.id,
        ownerPlan: event.ownerPlan,
        billingTier: event.billingTier,
        effectivePlan: access.effectivePlan,
        ctaPlan: 'unlock',
      })
    }
  }, [open, isOwner, canDownloadOriginal, event?.slug, event?.id, event?.ownerPlan, event?.billingTier, access.effectivePlan])

  useEffect(() => {
    if (unlockModalOpen && event?.slug) {
      trackEvent(EVENT_ORIGINAL_QUALITY_PAYWALL_VIEWED, {
        room_slug: event.slug,
        event_id: event.id,
        source: 'lightbox',
        actor_type: isOwner ? 'owner' : 'guest',
      })
    }
  }, [unlockModalOpen, event?.slug, event?.id, isOwner])

  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      onOpenChange(false)
      setIsClosing(false)
    }, 200)
  }, [onOpenChange])

  const selectPrevious = useCallback(() => {
    if (selectedIndex <= 0 || isNavigating) return
    setIsNavigating(true)
    onSelectIndex?.(selectedIndex - 1)
    setTimeout(() => setIsNavigating(false), 300)
  }, [selectedIndex, isNavigating, onSelectIndex])

  const selectNext = useCallback(() => {
    if (selectedIndex >= photos.length - 1 || isNavigating) return
    setIsNavigating(true)
    onSelectIndex?.(selectedIndex + 1)
    setTimeout(() => setIsNavigating(false), 300)
  }, [selectedIndex, photos.length, isNavigating, onSelectIndex])

  const performDownload = useCallback(
    async (quality) => {
      if (!photo?.id) return
      try {
        const apiUrl = `/api/download/photo?photoId=${encodeURIComponent(photo.id)}&type=${quality}`
        const response = await fetch(apiUrl)
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status}`)
        }
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const contentDisposition = response.headers.get('content-disposition')
        const fileNameMatch = contentDisposition?.match(/filename="([^"]+)"/)
        const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : `photo-${photo.id || selectedIndex + 1}.jpg`

        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
        setDownloaded(true)
        setTimeout(() => setDownloaded(false), 2000)

        if (isFreeRoom) {
          trackEvent(EVENT_BRANDED_PHOTO_DOWNLOADED, { room_slug: event.slug, quality, photo_id: photo.id })
        }
      } catch (e) {
        console.warn('[lightbox] download failed', e)
      }
    },
    [photo, selectedIndex, event?.slug, isFreeRoom]
  )

  const handleDownloadStandard = useCallback(() => {
    trackEvent(EVENT_DOWNLOAD_QUALITY_SELECTED, {
      room_slug: event?.slug,
      quality: 'standard',
      source: 'lightbox',
    })
    performDownload('standard')
  }, [event?.slug, performDownload])

  const handleDownloadOriginal = useCallback(() => {
    trackEvent(EVENT_DOWNLOAD_QUALITY_SELECTED, {
      room_slug: event?.slug,
      quality: 'original',
      source: 'lightbox',
    })
    if (canDownloadOriginal) {
      performDownload('original')
    }
  }, [canDownloadOriginal, event?.slug, performDownload])

  const handleUnlock = useCallback(async () => {
    if (!event?.slug) return
    setUnlockBusy(true)
    try {
      trackEvent(EVENT_ORIGINAL_DOWNLOAD_UNLOCK_CLICKED, {
        room_slug: event.slug,
        source: 'lightbox',
      })
      trackUpsellClick({
        upsellType: 'original_quality_unlock',
        source: 'lightbox_download_menu',
        eventSlug: event.slug,
        eventId: event.id,
        ownerPlan: event.ownerPlan,
        billingTier: event.billingTier,
        effectivePlan: access.effectivePlan,
        ctaPlan: 'unlock',
      })
      const response = await csrfFetch('/api/stripe/unlock-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug: event.slug }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Unable to start checkout')
      }
      window.location.href = payload.url
    } catch (e) {
      console.warn('[lightbox] unlock failed', e)
      setUnlockBusy(false)
    }
  }, [event?.slug, event?.id, event?.ownerPlan, event?.billingTier, access.effectivePlan])

  const handleGuestUnlockClick = useCallback(() => {
    trackEvent(EVENT_ORIGINAL_QUALITY_UNLOCK_CLICKED, {
      room_slug: event?.slug,
      event_id: event?.id,
      source: 'lightbox',
      actor_type: 'guest',
    })
    handleUnlock()
  }, [event?.slug, event?.id, handleUnlock])

  // Touch event handlers for swipe
  const onTouchStart = (e) => {
    isSwiping.current = false
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    }
  }

  const onTouchMove = (e) => {
    touchEnd.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    }

    // Mark as swiping if moved beyond threshold
    const deltaX = Math.abs(touchStart.current.x - touchEnd.current.x)
    const deltaY = Math.abs(touchStart.current.y - touchEnd.current.y)
    if (deltaX > 10 || deltaY > 10) {
      isSwiping.current = true
    }

    // Prevent browser scrolling during horizontal swipe
    if (deltaX > deltaY) {
      e.preventDefault()
    }
  }

  const onTouchEnd = () => {
    const deltaX = touchStart.current.x - touchEnd.current.x
    const deltaY = touchStart.current.y - touchEnd.current.y
    const deltaTime = touchEnd.current.time - touchStart.current.time
    const velocity = Math.abs(deltaX) / deltaTime

    // Horizontal swipe (navigation)
    if (
      Math.abs(deltaX) > Math.abs(deltaY) &&
      Math.abs(deltaX) > SWIPE_THRESHOLD &&
      velocity > SWIPE_VELOCITY
    ) {
      if (deltaX > 0) {
        selectNext()
      } else {
        selectPrevious()
      }
      return
    }

    // Vertical swipe down (close)
    if (deltaY < -SWIPE_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX) * 2) {
      handleClose()
    }
  }

  // Handle click - only close if not swiping
  const onContainerClick = (e) => {
    if (isSwiping.current) {
      e.stopPropagation()
      return
    }
    handleClose()
  }

  // Keyboard navigation
  useEffect(() => {
    if (!open || typeof window === 'undefined') return

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') selectPrevious()
      if (e.key === 'ArrowRight') selectNext()
      if (e.key === 'Escape') handleClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      try {
        window.removeEventListener('keydown', handleKeyDown)
      } catch {
        // ignore
      }
    }
  }, [open, selectPrevious, selectNext, handleClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (typeof document === 'undefined') return
    try {
      if (open) {
        document.body.style.overflow = 'hidden'
        document.body.style.touchAction = 'none'
      } else {
        document.body.style.overflow = ''
        document.body.style.touchAction = ''
      }
    } catch (e) {
      console.warn('[lightbox] failed to toggle body scroll', e)
    }
    return () => {
      try {
        if (typeof document !== 'undefined') {
          document.body.style.overflow = ''
          document.body.style.touchAction = ''
        }
      } catch {
        // ignore
      }
    }
  }, [open])

  if (!open || !photo) return null

  // Check for reduced motion preference
  const prefersReducedMotion = (() => {
    if (typeof window === 'undefined') return false
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch (e) {
      return false
    }
  })()

  const themeClass = 'dark'

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t.photoViewer}
      className={`fixed inset-0 z-50 bg-black touch-none ${themeClass} ${className} ${
        prefersReducedMotion ? '' : 'transition-opacity duration-200'
      } ${isClosing ? 'opacity-0' : 'opacity-100'}`}
      onClick={onContainerClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 text-sm text-foreground/90 backdrop-blur-sm">
          <span className="font-medium">{selectedIndex + 1}</span>
          <span className="text-foreground/40">/</span>
          <span className="text-foreground/60">{photos.length}</span>
        </div>
        {isOwner && (
          <div className={`hidden sm:flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-xs backdrop-blur-sm ${isFreeRoom ? 'text-white/70' : 'text-green-400/90'}`}>
            <span>{isFreeRoom ? t.brandingFreeLocked : t.brandingFreeAvailable}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className={`h-9 w-9 transition-colors ${
                  downloaded
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-foreground/80 hover:bg-white/10 hover:text-foreground'
                }`}
                onClick={(e) => e.stopPropagation()}
                title={downloaded ? t.downloaded : t.downloadPhoto}
              >
                <Download className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className={`border-border bg-surface text-foreground min-w-[14rem] ${themeClass}`}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className="cursor-pointer focus:bg-white/5 focus:text-foreground"
                onClick={handleDownloadStandard}
              >
                <div className="flex flex-col py-1">
                  <span className="text-sm font-medium">{t.standardQuality}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.standardQualityDesc}
                  </span>
                </div>
                <Check className="ml-auto h-4 w-4 text-success shrink-0" />
              </DropdownMenuItem>

              {canDownloadOriginal ? (
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-white/5 focus:text-foreground"
                  onClick={handleDownloadOriginal}
                >
                  <div className="flex flex-col py-1">
                    <span className="text-sm font-medium">{t.originalQuality}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.originalQualityDesc}
                    </span>
                  </div>
                  <Check className="ml-auto h-4 w-4 text-success shrink-0" />
                </DropdownMenuItem>
              ) : isOwner ? (
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-white/5 focus:text-foreground"
                  onClick={(e) => {
                    e.preventDefault()
                    handleUnlock()
                  }}
                  disabled={unlockBusy}
                >
                  <div className="flex flex-col py-1">
                    <span className="text-sm font-medium">{t.originalQuality}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.unlockForEveryone}
                    </span>
                  </div>
                  {unlockBusy ? (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <Lock className="ml-auto h-4 w-4 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="cursor-pointer focus:bg-white/5 focus:text-foreground"
                  onClick={(e) => {
                    e.preventDefault()
                    setUnlockModalOpen(true)
                  }}
                >
                  <div className="flex flex-col py-1">
                    <span className="text-sm font-medium">{t.originalQualityLockedGuest}</span>
                    <span className="text-xs text-muted-foreground">
                      {t.unlockOriginalForEvent}
                    </span>
                  </div>
                  <Lock className="ml-auto h-4 w-4 text-primary shrink-0" />
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-foreground/80 hover:bg-white/10 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Guest unlock modal */}
      <Dialog open={unlockModalOpen} onOpenChange={setUnlockModalOpen}>
        <DialogContent className="border-border bg-surface text-foreground dark sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.unlockOriginalTitle}</DialogTitle>
            <DialogDescription>{t.unlockOriginalDesc}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="rounded-lg bg-muted/50 px-4 py-3 text-center">
              <span className="text-2xl font-bold text-foreground">€1,99</span>
              <p className="mt-1 text-xs text-muted-foreground">{t.unlockOriginalForEvent}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => setUnlockModalOpen(false)}
                className="w-full sm:w-auto"
              >
                {t.maybeLater}
              </Button>
              <Button
                onClick={handleGuestUnlockClick}
                disabled={unlockBusy}
                className="w-full sm:w-auto"
              >
                {unlockBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t.unlockOriginalCta}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Main image area */}
      <div
        className={`flex h-full items-center justify-center px-12 py-20 ${
          prefersReducedMotion
            ? ''
            : `transition-all duration-300 ${isNavigating ? 'scale-95 opacity-80' : 'scale-100 opacity-100'}`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <ImageWithLoading key={photo.id || photo.url} src={photo.url} alt={photo.originalName || t.photo} />
      </div>

      {/* Navigation arrows (desktop) */}
      {photos.length > 1 && (
        <>
          <button
            disabled={selectedIndex <= 0}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-foreground/70 backdrop-blur-sm transition-all hover:bg-black/50 hover:text-foreground disabled:opacity-0 sm:left-4 sm:block"
            onClick={(e) => {
              e.stopPropagation()
              selectPrevious()
            }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            disabled={selectedIndex >= photos.length - 1}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-foreground/70 backdrop-blur-sm transition-all hover:bg-black/50 hover:text-foreground disabled:opacity-0 sm:right-4 sm:block"
            onClick={(e) => {
              e.stopPropagation()
              selectNext()
            }}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {/* Mobile swipe hint */}
      <div className="pointer-events-none absolute bottom-16 left-0 right-0 flex justify-center sm:hidden">
        <div className="rounded-full bg-black/30 px-3 py-1 text-[10px] text-foreground/50 backdrop-blur-sm">
          {t.swipeToNavigate}
        </div>
      </div>

      {/* Footer info */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-6 pt-12">
        <div className="mx-auto max-w-md text-center">
          <p className="truncate text-sm font-medium text-foreground/90">
            {photo.originalName || t.untitled}
          </p>
          {(photo.uploaderName || photo.caption) && (
            <p className="mt-0.5 truncate text-xs text-foreground/50">
              {photo.uploaderName && `${t.by} ${photo.uploaderName}`}
              {photo.uploaderName && photo.caption && ' • '}
              {photo.caption}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default PhotoLightbox
