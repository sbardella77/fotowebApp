'use client'

import Image from 'next/image'
import { QrCode, Heart, Users, Share2, ImagePlus } from 'lucide-react'

const DEFAULT_PHOTOS = [
  { src: '/marketing-placeholder/wedding-toast-thumb.jpg', alt: '', heart: true },
  { src: '/marketing-placeholder/wedding-detail-thumb.jpg', alt: '' },
  { src: '/marketing-placeholder/wedding-guests-thumb.jpg', alt: '', heart: true },
  { src: '/marketing-placeholder/wedding-dancefloor-thumb.jpg', alt: '' },
  { src: '/marketing-placeholder/wedding-group-thumb.jpg', alt: '' },
  { src: '/marketing-placeholder/wedding-couple-thumb.jpg', alt: '', heart: true },
]

export function PhoneMockup({ eventName = "Sarah & Mike's Wedding", url = 'snaprooms.app/event/sarah-mike', photos = DEFAULT_PHOTOS }) {
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      {/* Glow behind */}
      <div className="absolute -inset-4 rounded-[3rem] bg-primary/10 blur-2xl" aria-hidden="true" />

      {/* Phone frame */}
      <div className="relative rounded-[2.5rem] border border-border bg-card p-3 shadow-elevated">
        {/* Notch */}
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-border" />

        {/* Screen */}
        <div className="rounded-[2rem] border border-[hsl(var(--border-subtle))] bg-background overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[hsl(var(--border-subtle))] bg-card px-4 py-3">
            <div>
              <p className="font-display text-xs font-bold text-foreground truncate max-w-[140px]">{eventName}</p>
              <p className="font-mono text-[9px] text-muted-foreground">{url}</p>
            </div>
            <Share2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-3 gap-0.5 p-2">
            {photos.slice(0, 6).map((photo, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg bg-secondary">
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  sizes="93px"
                  className="object-cover"
                  priority={i === 0}
                />
                {photo.heart && (
                  <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm">
                    <Heart className="h-2.5 w-2.5 text-rose-500 fill-rose-500" aria-hidden="true" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* QR area */}
          <div className="px-4 pb-4 pt-1">
            <div className="mx-auto flex w-fit flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card p-4">
              <svg width="72" height="72" viewBox="0 0 96 96" fill="none" className="text-foreground" aria-hidden="true">
                <rect width="96" height="96" rx="12" fill="currentColor" fillOpacity="0.06"/>
                <rect x="8" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="12" width="16" height="16" rx="2" fill="hsl(var(--bg-base))"/>
                <rect x="16" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="68" y="12" width="16" height="16" rx="2" fill="hsl(var(--bg-base))"/>
                <rect x="72" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="8" y="64" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="68" width="16" height="16" rx="2" fill="hsl(var(--bg-base))"/>
                <rect x="16" y="72" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="36" y="8" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="48" y="8" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="36" y="20" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="52" y="20" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="8" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="20" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="36" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="48" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="80" y="36" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="36" y="48" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="52" y="48" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="48" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="80" y="48" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="8" y="52" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="20" y="52" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="36" y="64" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="48" y="64" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="64" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="80" y="64" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="52" y="80" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="80" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="80" y="80" width="8" height="8" rx="2" fill="currentColor"/>
              </svg>
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Scan to upload</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -right-2 top-1/4 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-elevated animate-fade-in">
        <span className="flex items-center gap-1.5">
          <ImagePlus className="h-3 w-3 text-accent-dark" aria-hidden="true" />
          <span className="font-mono text-[10px] text-foreground">Instant upload</span>
        </span>
      </div>
      <div className="absolute -left-2 bottom-1/3 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-elevated">
        <span className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-accent-dark" aria-hidden="true" />
          <span className="font-mono text-[10px] text-foreground">47 photos</span>
        </span>
      </div>
    </div>
  )
}
