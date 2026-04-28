'use client'

import { Camera } from 'lucide-react'

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.07] bg-[#0D1220] py-10">
      <div className="container px-4">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Camera className="h-3 w-3" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
          </a>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="/pricing" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
            <a href="/for-wedding-photographers" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              For Photographers
            </a>
            <a href="/for-event-planners" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              For Planners
            </a>
            <a href="/privacy" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            <a href="/terms" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              Terms of Service
            </a>
            <a href="/commercial-license" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              Commercial License
            </a>
            <a href="/dashboard/login" className="text-xs font-light text-muted-foreground hover:text-foreground transition-colors">
              Organizer sign in
            </a>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs font-light text-muted-foreground/60">
            The easiest way to collect guest photos. Built with care for hosts, photographers, and event professionals.
          </p>
        </div>
      </div>
    </footer>
  )
}
