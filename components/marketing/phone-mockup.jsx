'use client'

import { QrCode, Heart, Users, Share2, ImagePlus } from 'lucide-react'

export function PhoneMockup({ eventName = "Sarah & Mike's Wedding", url = "snaprooms.app/room/sarah-mike" }) {
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      {/* Glow behind */}
      <div className="absolute -inset-4 rounded-[3rem] bg-primary/5 blur-2xl" aria-hidden="true" />

      {/* Phone frame */}
      <div className="relative rounded-[2.5rem] border border-white/[0.08] bg-raised p-3 shadow-elevated">
        {/* Notch */}
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/10" />

        {/* Screen */}
        <div className="rounded-[2rem] border border-white/[0.06] bg-background overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] bg-surface px-4 py-3">
            <div>
              <p className="font-display text-xs font-bold text-foreground truncate max-w-[140px]">{eventName}</p>
              <p className="font-mono text-[9px] text-muted-foreground">{url}</p>
            </div>
            <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-3 gap-0.5 p-2">
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-rose-400/20 to-rose-600/10 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                <Heart className="h-2.5 w-2.5 text-rose-300 fill-rose-300" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-amber-400/20 to-amber-600/10 overflow-hidden" />
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-emerald-400/20 to-emerald-600/10 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                <Heart className="h-2.5 w-2.5 text-emerald-300 fill-emerald-300" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-sky-400/20 to-sky-600/10 overflow-hidden" />
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-violet-400/20 to-violet-600/10 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="h-5 w-5 text-white/15" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-orange-400/20 to-orange-600/10 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                <Heart className="h-2.5 w-2.5 text-orange-300 fill-orange-300" />
              </div>
            </div>
          </div>

          {/* QR area */}
          <div className="px-4 pb-4 pt-1">
            <div className="mx-auto flex w-fit flex-col items-center gap-2 rounded-xl border border-dashed border-white/[0.08] bg-surface p-4">
              <svg width="72" height="72" viewBox="0 0 96 96" fill="none" className="text-foreground">
                <rect width="96" height="96" rx="12" fill="currentColor" fillOpacity="0.05"/>
                <rect x="8" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="12" width="16" height="16" rx="2" fill="hsl(var(--bg-raised))"/>
                <rect x="16" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="68" y="12" width="16" height="16" rx="2" fill="hsl(var(--bg-raised))"/>
                <rect x="72" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="8" y="64" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="68" width="16" height="16" rx="2" fill="hsl(var(--bg-raised))"/>
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
      <div className="absolute -right-2 top-1/4 rounded-full border border-white/[0.08] bg-elevated px-3 py-1.5 text-xs font-medium shadow-elevated animate-fade-in">
        <span className="flex items-center gap-1.5">
          <ImagePlus className="h-3 w-3 text-primary" />
          <span className="font-mono text-[10px] text-foreground">Instant upload</span>
        </span>
      </div>
      <div className="absolute -left-2 bottom-1/3 rounded-full border border-white/[0.08] bg-elevated px-3 py-1.5 text-xs font-medium shadow-elevated">
        <span className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-success" />
          <span className="font-mono text-[10px] text-foreground">47 photos</span>
        </span>
      </div>
    </div>
  )
}
