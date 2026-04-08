'use client'

import { AlertCircle, ImageIcon, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const skeletonItems = Array.from({ length: 6 }, (_, index) => index)

const PhotoGalleryGrid = ({
  photos = [],
  loading = false,
  error = '',
  onRetry,
  onSelectPhoto,
  showUploader = true,
  emptyTitle = 'Your first gallery is one upload away.',
  emptyDescription = 'Open an event and upload from your phone to start the gallery.',
}) => {
  if (loading && photos.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {skeletonItems.map((item) => (
          <div key={item} className={`overflow-hidden rounded-3xl border border-border bg-card ${item === 0 ? 'sm:col-span-2' : ''}`}>
            <div className={`animate-pulse bg-muted/70 ${item === 0 ? 'aspect-[4/5]' : 'aspect-square'}`} />
            <div className="space-y-2 p-3">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted/70" />
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-muted/50" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid min-h-[260px] place-items-center rounded-3xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <div className="max-w-sm space-y-3">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-medium">Could not load this gallery</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className="grid min-h-[300px] place-items-center rounded-3xl border border-dashed border-border bg-muted/20 p-6 text-center">
        <div className="max-w-sm space-y-3">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-base font-medium">{emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo, index) => (
        <button
          key={photo.id}
          className={`group overflow-hidden rounded-3xl border border-border bg-card text-left transition hover:-translate-y-0.5 hover:shadow-lg ${index === 0 ? 'sm:col-span-2' : ''}`}
          onClick={() => onSelectPhoto?.(index)}
          type="button"
        >
          <div className={`relative overflow-hidden bg-muted ${index === 0 ? 'aspect-[4/5]' : 'aspect-square'}`}>
            <img
              alt={photo.originalName}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              decoding="async"
              loading={index < 4 ? 'eager' : 'lazy'}
              src={photo.url}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
              {index === 0 ? <Badge className="rounded-full bg-background/90 text-foreground hover:bg-background/90">Newest</Badge> : <span />}
              <Badge variant="secondary" className="rounded-full bg-background/90 text-foreground hover:bg-background/90">
                Tap to open
              </Badge>
            </div>
            {showUploader ? (
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <p className="truncate text-sm font-medium">{photo.originalName}</p>
                <p className="truncate text-xs text-white/80">{photo.uploaderName || 'Guest upload'}</p>
              </div>
            ) : null}
          </div>
        </button>
      ))}
    </div>
  )
}

export default PhotoGalleryGrid
