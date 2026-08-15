'use client'

import { useEffect } from 'react'
import { Camera, RefreshCcw } from 'lucide-react'
import { resolveErrorBoundaryLocale, getErrorBoundaryCopy } from '@/lib/i18n/error-boundary'

export default function EventError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log minimal diagnostics in production, more in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[event-error] Client-side error on public event page:', error)
    } else {
      console.error('[event-error] Public event page crashed:', error.message, 'digest:', error.digest)
    }
  }, [error])

  const locale = resolveErrorBoundaryLocale()
  const copy = getErrorBoundaryCopy(locale)

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <header className="border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Camera className="h-4 w-4" />
            </div>
            <span className="font-display text-sm font-bold tracking-tight text-foreground">SnapRooms</span>
          </a>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Camera className="h-7 w-7" />
        </div>

        <div className="max-w-sm">
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {copy.eventTitle}
          </h1>
          <p className="mt-3 text-sm font-light text-muted-foreground leading-relaxed">
            {copy.eventBody}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCcw className="h-4 w-4" />
            {copy.reloadPage}
          </button>
          <a
            href="/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:bg-elevated hover:text-foreground"
          >
            {copy.backToHome}
          </a>
        </div>
      </div>
    </main>
  )
}
