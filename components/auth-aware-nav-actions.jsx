'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { safeReadJson } from '@/lib/nav-session-helpers'

/**
 * Auth-aware actions for the public marketing navigation.
 *
 * On mount, it checks the owner session via a lightweight GET to
 * /api/owner/session and renders:
 *  - "Dashboard" button when the owner is authenticated
 *  - "Sign in" button(s) when anonymous or the check fails
 *
 * While the check is running, a neutral skeleton is shown to avoid
 * a Login → Dashboard flicker for authenticated users.
 */
export function AuthAwareNavActions() {
  const t = useTranslations('nav')
  const [state, setState] = useState({ loading: true, authenticated: false })

  useEffect(() => {
    let cancelled = false

    fetch('/api/owner/session', { cache: 'no-store' })
      .then(safeReadJson)
      .then((payload) => {
        if (cancelled) return
        setState({ loading: false, authenticated: !!payload?.authenticated })
      })
      .catch((error) => {
        if (cancelled) return
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('[auth-aware-nav] session check failed:', error)
        }
        setState({ loading: false, authenticated: false })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden h-9 w-20 animate-pulse rounded-md bg-muted sm:block" />
      </div>
    )
  }

  if (state.authenticated) {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          asChild
          className="h-9 px-2.5 text-sm font-semibold sm:hidden flex-shrink-0"
        >
          <a href="/dashboard">{t.dashboard}</a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="hidden sm:inline-flex text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <a href="/dashboard">{t.dashboard}</a>
        </Button>
      </>
    )
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        asChild
        className="h-9 px-2.5 text-sm font-semibold sm:hidden flex-shrink-0"
      >
        <a href="/dashboard/login">{t.signIn}</a>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        asChild
        className="hidden sm:inline-flex text-muted-foreground hover:text-foreground flex-shrink-0"
      >
        <a href="/dashboard/login">{t.signIn}</a>
      </Button>
    </>
  )
}
