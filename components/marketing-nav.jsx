'use client'

import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'

function scrollToSection(sectionId) {
  const element = document.getElementById(sectionId)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
  }
}

export function MarketingNav({ variant = 'default', ctaAction = 'scroll' }) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-40 border-b border-white/[0.07] bg-background/80 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between px-4">
        <a href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Camera className="h-4 w-4" />
          </div>
          <span className="font-display text-sm font-bold tracking-tight text-primary">SnapRooms</span>
        </a>

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="/pricing"
            className="hidden text-sm text-muted-foreground hover:text-foreground sm:block"
          >
            Pricing
          </a>
          <a
            href="/for-wedding-photographers"
            className="hidden text-sm text-muted-foreground hover:text-foreground lg:block"
          >
            For Photographers
          </a>
          <a
            href="/for-event-planners"
            className="hidden text-sm text-muted-foreground hover:text-foreground lg:block"
          >
            For Planners
          </a>

          <Button size="sm" variant="ghost" asChild className="font-body">
            <a href="/dashboard/login">Sign in</a>
          </Button>

          {ctaAction === 'scroll' ? (
            <Button size="sm" onClick={() => scrollToSection('create')} className="font-body">
              Create room
            </Button>
          ) : (
            <Button size="sm" asChild className="font-body">
              <a href="/">Create room</a>
            </Button>
          )}
        </div>
      </div>
    </nav>
  )
}
