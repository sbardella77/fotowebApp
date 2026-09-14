'use client'

import { AlertCircle, ImageIcon, ImageOff, Loader2, RefreshCcw, Upload } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { getRenderablePhotos } from '@/lib/photo-utils'

const skeletonItems = Array.from({ length: 12 }, (_, index) => index)

const ImageWithLazyLoad = ({ src, alt, className, onLoad }) => {
  const [status, setStatus] = useState('loading')
  const [isVisible, setIsVisible] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    let observer
    try {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsVisible(true)
            try {
              observer?.disconnect()
            } catch {
              // ignore
            }
          }
        },
        { rootMargin: '50px' }
      )

      if (imgRef.current) {
        observer.observe(imgRef.current)
      }
    } catch (e) {
      console.warn('[gallery] IntersectionObserver not available', e)
      setIsVisible(true)
    }

    return () => {
      try {
        observer?.disconnect()
      } catch {
        // ignore
      }
    }
  }, [])

  const handleLoad = () => {
    setStatus('loaded')
    onLoad?.()
  }

  return (
    <div ref={imgRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted">
          <ImageOff className="h-5 w-5 text-muted-foreground/40" />
        </div>
      )}
      {isVisible && (
        <img
          alt={alt}
          className={`h-full w-full object-cover transition-all duration-500 ${
            status === 'loaded' ? 'scale-100 opacity-100' : 'scale-105 opacity-0'
          }`}
          decoding="async"
          loading="lazy"
          src={src}
          onError={() => setStatus('error')}
          onLoad={handleLoad}
        />
      )}
    </div>
  )
}

const PhotoGalleryGrid = ({
  photos = [],
  loading = false,
  error = '',
  onRetry,
  onSelectPhoto,
  onUploadClick,
  emptyTitle,
  emptyDescription,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}) => {
  const t = useTranslations('room')
  const safePhotos = getRenderablePhotos(photos)

  if (loading && safePhotos.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4">
        {skeletonItems.map((item) => (
          <div 
            key={item} 
            className="relative aspect-square animate-pulse rounded-xl bg-muted"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <AlertCircle className="h-8 w-8 text-destructive/60" />
        <div>
          <p className="text-sm font-medium">{t.unableToLoadGallery}</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-9">
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            {t.retry}
          </Button>
        )}
      </div>
    )
  }

  if (safePhotos.length === 0) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <div className="rounded-2xl bg-primary/10 p-4">
          <ImageIcon className="h-8 w-8 text-primary/70" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">{emptyTitle || t.beFirstToUpload}</p>
          <p className="mt-1 text-sm font-light text-muted-foreground max-w-xs mx-auto">{emptyDescription || t.photosWillAppearHere}</p>
        </div>
        {onUploadClick && (
          <Button size="sm" className="cta-primary gap-1.5 mt-1" onClick={onUploadClick}>
            <Upload className="h-4 w-4" />
            {t.uploadToEvent}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4">
        {safePhotos.map((photo, index) => (
          <button
            key={photo.id}
            className="group relative aspect-square overflow-hidden rounded-xl bg-muted transition-transform duration-200 will-change-transform active:scale-95"
            onClick={() => onSelectPhoto?.(index)}
            type="button"
            aria-label={`${t.photo} ${index + 1} / ${safePhotos.length}${photo.originalName ? `, ${photo.originalName}` : ''}`}
          >
            {photo.url ? (
              <ImageWithLazyLoad
                src={photo.url}
                alt={photo.originalName || `${t.photo} ${index + 1}`}
                className="transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              // No safe derivative exists for this photo yet (PENDING /
              // FAILED / LEGACY_UNVERIFIED) — explicit unavailable tile.
              // NEVER fall back to an original source URL here: there is
              // none in scope (the guest DTO only ever sends a derivative
              // URL or null, see lib/server/guest-photo-url.js).
              <div className="flex h-full w-full items-center justify-center bg-muted">
                <ImageOff className="h-5 w-5 text-muted-foreground/40" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
          </button>
        ))}
        {loadingMore && Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`skeleton-more-${index}`}
            className="relative aspect-square animate-pulse rounded-xl bg-muted"
          />
        ))}
      </div>
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="border-border bg-raised hover:bg-elevated hover:text-foreground"
          >
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.loadMore || 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

export default PhotoGalleryGrid
