'use client'

import { QrCode, Heart, Users, Share2, ImagePlus } from 'lucide-react'

export function PhoneMockup({ eventName = "Sarah & Mike's Wedding", url = "snaprooms.app/event/sarah-mike" }) {
  return (
    <div className="relative mx-auto w-full max-w-[280px]">
      {/* Glow behind */}
      <div className="absolute -inset-4 rounded-[3rem] bg-[#E7EF3A]/10 blur-2xl" aria-hidden="true" />

      {/* Phone frame */}
      <div className="relative rounded-[2.5rem] border border-[#DDD7CA] bg-white p-3 shadow-elevated">
        {/* Notch */}
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-[#DDD7CA]" />

        {/* Screen */}
        <div className="rounded-[2rem] border border-[#EEE8DC] bg-[#F8F6F1] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#EEE8DC] bg-white px-4 py-3">
            <div>
              <p className="font-display text-xs font-bold text-[#222222] truncate max-w-[140px]">{eventName}</p>
              <p className="font-mono text-[9px] text-[#7A746B]">{url}</p>
            </div>
            <Share2 className="h-3.5 w-3.5 text-[#7A746B]" />
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-3 gap-0.5 p-2">
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-rose-200/60 to-rose-300/40 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm">
                <Heart className="h-2.5 w-2.5 text-rose-400 fill-rose-400" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-amber-200/60 to-amber-300/40 overflow-hidden" />
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-emerald-200/60 to-emerald-300/40 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm">
                <Heart className="h-2.5 w-2.5 text-emerald-400 fill-emerald-400" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-sky-200/60 to-sky-300/40 overflow-hidden" />
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-violet-200/60 to-violet-300/40 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <Users className="h-5 w-5 text-[#DDD7CA]" />
              </div>
            </div>
            <div className="relative aspect-square rounded-lg bg-gradient-to-br from-orange-200/60 to-orange-300/40 overflow-hidden">
              <div className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-sm">
                <Heart className="h-2.5 w-2.5 text-orange-400 fill-orange-400" />
              </div>
            </div>
          </div>

          {/* QR area */}
          <div className="px-4 pb-4 pt-1">
            <div className="mx-auto flex w-fit flex-col items-center gap-2 rounded-xl border border-dashed border-[#DDD7CA] bg-white p-4">
              <svg width="72" height="72" viewBox="0 0 96 96" fill="none" className="text-[#222222]">
                <rect width="96" height="96" rx="12" fill="currentColor" fillOpacity="0.05"/>
                <rect x="8" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="12" width="16" height="16" rx="2" fill="hsl(40 23% 95%)"/>
                <rect x="16" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="64" y="8" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="68" y="12" width="16" height="16" rx="2" fill="hsl(40 23% 95%)"/>
                <rect x="72" y="16" width="8" height="8" rx="2" fill="currentColor"/>
                <rect x="8" y="64" width="24" height="24" rx="4" fill="currentColor"/>
                <rect x="12" y="68" width="16" height="16" rx="2" fill="hsl(40 23% 95%)"/>
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
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#7A746B]">Scan to upload</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -right-2 top-1/4 rounded-full border border-[#DDD7CA] bg-white px-3 py-1.5 text-xs font-medium shadow-elevated animate-fade-in">
        <span className="flex items-center gap-1.5">
          <ImagePlus className="h-3 w-3 text-[#8A9A1B]" />
          <span className="font-mono text-[10px] text-[#222222]">Instant upload</span>
        </span>
      </div>
      <div className="absolute -left-2 bottom-1/3 rounded-full border border-[#DDD7CA] bg-white px-3 py-1.5 text-xs font-medium shadow-elevated">
        <span className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-[#8A9A1B]" />
          <span className="font-mono text-[10px] text-[#222222]">47 photos</span>
        </span>
      </div>
    </div>
  )
}
