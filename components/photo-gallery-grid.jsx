'use client'

import { AlertCircle, ImageIcon, ImageOff, Loader2, RefreshCcw } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'

const skeletonItems = Array.from({ length: 12 }, (_, index) => index)

const ImageWithLazyLoad = ({ src, alt, className, onLoad }) => {
  const [status, setStatus] = useState('loading')
  const [isVisible, setIsVisible] = useState(false)
  const imgRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '50px' }
    )

    if (imgRef.current) {
      observer.observe(imgRef.current)
    }

    return () => observer.disconnect()
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
  emptyTitle = 'No photos yet',
  emptyDescription = 'Be the first to add a photo.',
}) => {
  if (loading && photos.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4">
        {skeletonItems.map((item) => (
          <div 
            key={item} 
            className="relative aspect-square animate-pulse bg-muted"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
        <AlertCircle className="h-7 w-7 text-destructive/60" />
        <div>
          <p className="text-sm font-medium">Failed to load</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-8">
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        )}
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
        <div className="rounded-full bg-primary/10 p-3">
          <ImageIcon className="h-6 w-6 text-primary/60" />
        </div>
        <div>
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{emptyDescription}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4">
      {photos.map((photo, index) => (
        <button
          key={photo.id}
          className="group relative aspect-square overflow-hidden bg-muted transition-transform duration-200 will-change-transform active:scale-95"
          onClick={() => onSelectPhoto?.(index)}
          type="button"
          aria-label={`View photo ${index + 1} of ${photos.length}${photo.originalName ? `, ${photo.originalName}` : ''}`}
        >
          <ImageWithLazyLoad
            src={photo.url}
            alt={photo.originalName || `Photo ${index + 1}`}
            className="transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10" />
        </button>
      ))}
    </div>
  )
}

export default PhotoGalleryGrid
