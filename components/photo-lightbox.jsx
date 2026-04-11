'use client'

import { ChevronLeft, ChevronRight, Download, ImageOff, Loader2, X } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogOverlay } from '@/components/ui/dialog'

const ImageWithLoading = ({ src, alt }) => {
  const [status, setStatus] = useState('loading')

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-white/70" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-white/70">
          <ImageOff className="h-12 w-12" />
          <span className="text-sm">Failed to load image</span>
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

  const selectPrevious = useCallback(() => {
    if (selectedIndex <= 0) return
    onSelectIndex?.(selectedIndex - 1)
  }, [selectedIndex, onSelectIndex])

  const selectNext = useCallback(() => {
    if (selectedIndex >= photos.length - 1) return
    onSelectIndex?.(selectedIndex + 1)
  }, [selectedIndex, photos.length, onSelectIndex])

  const handleDownload = useCallback(() => {
    if (!photo?.url) return
    
    const link = document.createElement('a')
    const filename = photo.originalName || `photo-${photo.id || selectedIndex + 1}.jpg`
    link.download = filename
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    
    fetch(photo.url, { mode: 'cors' })
      .then((response) => {
        if (!response.ok) throw new Error('Network response was not ok')
        return response.blob()
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob)
        link.href = blobUrl
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000)
      })
      .catch(() => {
        link.href = photo.url
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      })
  }, [photo, selectedIndex])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') selectPrevious()
      if (e.key === 'ArrowRight') selectNext()
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectPrevious, selectNext])

  if (!photo) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="fixed inset-0 z-50 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center border-0 bg-black/95 p-0 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        style={{ transform: 'none', left: 0, top: 0 }}
      >
        <DialogTitle className="sr-only">
          Photo viewer - {photo.originalName || 'Image'} ({selectedIndex + 1} of {photos.length})
        </DialogTitle>
        
        {/* Hidden close button for accessibility - we use custom one */}
        <button 
          className="sr-only" 
          onClick={() => onOpenChange(false)}
          aria-label="Close lightbox"
        >
          Close
        </button>

        {/* Top bar */}
        <div className="absolute left-4 right-4 top-4 z-50 flex items-center justify-between sm:left-6 sm:right-6 sm:top-6">
          <div className="rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-sm">
            {selectedIndex + 1} / {photos.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="secondary"
              className="rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
              onClick={handleDownload}
              title="Download image"
            >
              <Download className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              className="rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
              onClick={() => onOpenChange(false)}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Navigation - Previous */}
        <div className="absolute left-2 top-1/2 z-50 -translate-y-1/2 sm:left-4">
          <Button
            disabled={selectedIndex <= 0}
            size="icon"
            variant="secondary"
            className="h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm disabled:opacity-30 sm:h-12 sm:w-12"
            onClick={selectPrevious}
          >
            <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
        </div>

        {/* Navigation - Next */}
        <div className="absolute right-2 top-1/2 z-50 -translate-y-1/2 sm:right-4">
          <Button
            disabled={selectedIndex >= photos.length - 1}
            size="icon"
            variant="secondary"
            className="h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm disabled:opacity-30 sm:h-12 sm:w-12"
            onClick={selectNext}
          >
            <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
          </Button>
        </div>

        {/* Main image */}
        <div className="h-[calc(100vh-160px)] w-full px-16 py-8">
          <ImageWithLoading
            src={photo.url}
            alt={photo.originalName || 'Photo'}
          />
        </div>

        {/* Bottom info panel */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-black/50 p-4 backdrop-blur-sm sm:p-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-center sm:text-left">
              <p className="truncate text-sm font-medium text-white sm:text-base">
                {photo.originalName || 'Untitled'}
              </p>
              <p className="mt-0.5 text-xs text-white/70">
                Uploaded by {photo.uploaderName || 'Guest'}
                {photo.status && photo.status !== 'visible' && ` • ${photo.status.toLowerCase()}`}
              </p>
            </div>
            {photo.caption ? (
              <p className="max-w-md text-center text-xs text-white/60 sm:text-right sm:text-sm">
                {photo.caption}
              </p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PhotoLightbox
