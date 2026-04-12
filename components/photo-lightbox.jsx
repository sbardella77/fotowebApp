'use client'

import { ChevronLeft, ChevronRight, Download, ImageOff, Loader2, X } from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

const SWIPE_THRESHOLD = 50
const SWIPE_VELOCITY = 0.5

const ImageWithLoading = ({ src, alt }) => {
  const [status, setStatus] = useState('loading')

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/40" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-2 text-white/40">
          <ImageOff className="h-10 w-10" />
          <span className="text-sm">Failed to load</span>
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

const PhotoLightbox = ({ open, onOpenChange, photos = [], selectedIndex = 0, onSelectIndex }) => {
  const photo = photos[selectedIndex] || null
  const [isClosing, setIsClosing] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  
  // Touch handling refs
  const touchStart = useRef({ x: 0, y: 0, time: 0 })
  const touchEnd = useRef({ x: 0, y: 0, time: 0 })
  const isSwiping = useRef(false)
  const containerRef = useRef(null)

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

  const handleDownload = useCallback(() => {
    if (!photo?.url) return
    const link = document.createElement('a')
    link.href = photo.url
    link.download = photo.originalName || `photo-${photo.id || selectedIndex + 1}.jpg`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 2000)
  }, [photo, selectedIndex])

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
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD && velocity > SWIPE_VELOCITY) {
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
    if (!open) return
    
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') selectPrevious()
      if (e.key === 'ArrowRight') selectNext()
      if (e.key === 'Escape') handleClose()
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectPrevious, selectNext, handleClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      document.body.style.touchAction = 'none'
    } else {
      document.body.style.overflow = ''
      document.body.style.touchAction = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.body.style.touchAction = ''
    }
  }, [open])

  if (!open || !photo) return null

  // Check for reduced motion preference
  const prefersReducedMotion = typeof window !== 'undefined' 
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches 
    : false

  return (
    <div 
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className={`fixed inset-0 z-50 bg-black touch-none ${
        prefersReducedMotion ? '' : 'transition-opacity duration-200'
      } ${isClosing ? 'opacity-0' : 'opacity-100'}`}
      onClick={onContainerClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 text-sm text-white/90 backdrop-blur-sm">
          <span className="font-medium">{selectedIndex + 1}</span>
          <span className="text-white/40">/</span>
          <span className="text-white/60">{photos.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className={`h-9 w-9 transition-colors ${
              downloaded 
                ? 'text-green-400 hover:text-green-300' 
                : 'text-white/80 hover:bg-white/10 hover:text-white'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              handleDownload()
            }}
            title={downloaded ? 'Downloaded!' : 'Download photo'}
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Main image area */}
      <div 
        className={`flex h-full items-center justify-center px-12 py-20 ${
          prefersReducedMotion 
            ? '' 
            : `transition-all duration-300 ${isNavigating ? 'scale-95 opacity-80' : 'scale-100 opacity-100'}`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <ImageWithLoading
          src={photo.url}
          alt={photo.originalName || 'Photo'}
        />
      </div>

      {/* Navigation arrows (desktop) */}
      {photos.length > 1 && (
        <>
          <button
            disabled={selectedIndex <= 0}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white/70 backdrop-blur-sm transition-all hover:bg-black/50 hover:text-white disabled:opacity-0 sm:left-4 sm:block"
            onClick={(e) => {
              e.stopPropagation()
              selectPrevious()
            }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            disabled={selectedIndex >= photos.length - 1}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/30 p-2 text-white/70 backdrop-blur-sm transition-all hover:bg-black/50 hover:text-white disabled:opacity-0 sm:right-4 sm:block"
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
        <div className="rounded-full bg-black/30 px-3 py-1 text-[10px] text-white/50 backdrop-blur-sm">
          Swipe to navigate • Pull down to close
        </div>
      </div>

      {/* Footer info */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-6 pt-12">
        <div className="mx-auto max-w-md text-center">
          <p className="truncate text-sm font-medium text-white/90">
            {photo.originalName || 'Untitled'}
          </p>
          {(photo.uploaderName || photo.caption) && (
            <p className="mt-0.5 truncate text-xs text-white/50">
              {photo.uploaderName && `By ${photo.uploaderName}`}
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
