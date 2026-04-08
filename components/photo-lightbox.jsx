'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const PhotoLightbox = ({ open, onOpenChange, photos = [], selectedIndex = 0, onSelectIndex }) => {
  const photo = photos[selectedIndex] || null

  const selectPrevious = () => {
    if (selectedIndex <= 0) {
      return
    }

    onSelectIndex?.(selectedIndex - 1)
  }

  const selectNext = () => {
    if (selectedIndex >= photos.length - 1) {
      return
    }

    onSelectIndex?.(selectedIndex + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl border-border bg-background p-0 sm:rounded-2xl">
        {photo ? (
          <div className="relative overflow-hidden rounded-2xl">
            <div className="absolute left-3 right-3 top-3 z-20 flex items-center justify-between">
              <div className="rounded-full bg-background/90 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
                {selectedIndex + 1} / {photos.length}
              </div>
              <Button size="icon" variant="secondary" className="rounded-full" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="relative flex min-h-[340px] items-center justify-center bg-black">
                <img alt={photo.originalName} className="max-h-[78vh] w-full object-contain" src={photo.url} />

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />

                <div className="absolute inset-y-0 left-3 flex items-center">
                  <Button
                    disabled={selectedIndex <= 0}
                    size="icon"
                    variant="secondary"
                    className="pointer-events-auto rounded-full"
                    onClick={selectPrevious}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>

                <div className="absolute inset-y-0 right-3 flex items-center">
                  <Button
                    disabled={selectedIndex >= photos.length - 1}
                    size="icon"
                    variant="secondary"
                    className="pointer-events-auto rounded-full"
                    onClick={selectNext}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <p className="text-lg font-semibold">{photo.originalName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{photo.uploaderName || 'Guest upload'}</p>
                </div>

                {photo.caption ? <p className="text-sm leading-6 text-muted-foreground">{photo.caption}</p> : null}

                <div className="grid gap-2 text-sm">
                  <div className="rounded-2xl border border-border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Status</p>
                    <p className="mt-1 font-medium capitalize">{photo.status?.toLowerCase() || 'visible'}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/30 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Uploaded by</p>
                    <p className="mt-1 font-medium">{photo.uploaderName || 'Guest'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default PhotoLightbox
