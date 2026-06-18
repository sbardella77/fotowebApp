'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Dashboard-specific error boundary.
 *
 * Catches render and data-loading errors inside /dashboard and shows a
 * recovery UI instead of falling through to the global error boundary,
 * which still uses gallery-oriented copy.
 */
export default function DashboardError({ error, reset }) {
  useEffect(() => {
    // Log to the console in development and to any available error reporter
    // in production without breaking the error boundary itself.
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.error('[dashboard/error] caught error:', error)
    }
  }, [error])

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-20 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-10 w-10" />
      </div>
      <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
        Dashboard nicht verfügbar
      </h1>
      <p className="mt-3 max-w-sm text-sm font-light leading-relaxed text-muted-foreground">
        Ihr Dashboard konnte leider nicht geladen werden. Bitte versuchen Sie es erneut.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
        <Button
          className="cta-primary"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.reload()
            } else if (reset) {
              reset()
            }
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Seite neu laden
        </Button>
        <Button
          variant="outline"
          className="border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.href = '/'
            }
          }}
        >
          Zurück zur Startseite
        </Button>
      </div>
    </div>
  )
}
