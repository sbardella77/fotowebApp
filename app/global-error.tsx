'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.error('[global-error] Unhandled application error:', error)
    } else {
      console.error('[global-error] App crashed:', error.message, 'digest:', error.digest)
    }
  }, [error])

  return (
    <html lang="de">
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="max-w-sm">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Ein Fehler ist aufgetreten
            </h1>
            <p className="mt-3 text-sm font-light text-muted-foreground leading-relaxed">
              Diese Galerie konnte leider nicht geladen werden. Bitte versuchen Sie es erneut.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => window.location.reload()}
              className="cta-primary inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium transition-colors"
            >
              Seite neu laden
            </button>
            <a
              href="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:bg-elevated"
            >
              Zurück zur Startseite
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
