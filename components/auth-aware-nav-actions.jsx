'use client'

import { useOwnerSession } from '@/lib/use-owner-session'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { resolveCreateEventCtaState } from '@/lib/create-event-cta-state'

export function AuthAwareNavActions({ t, anonymousCreateHref = '/' }) {
  const { authenticated, loading } = useOwnerSession()

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>
    )
  }

  const { href: authenticatedCreateHref } = resolveCreateEventCtaState({ authenticated: true })
  const createEventHref = authenticated ? authenticatedCreateHref : anonymousCreateHref

  return (
    <div className="flex items-center gap-2">
      {authenticated ? (
        <Button variant="outline" size="sm" asChild>
          <a href="/dashboard">{t.dashboard}</a>
        </Button>
      ) : (
        <>
          <Button variant="outline" size="sm" asChild className="sm:hidden">
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>
        </>
      )}

      <Button
        size="sm"
        asChild
        className="cta-primary font-semibold flex-shrink-0 whitespace-nowrap"
      >
        <a href={createEventHref}>{t.createRoom}</a>
      </Button>
    </div>
  )
}
