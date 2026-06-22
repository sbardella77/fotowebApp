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
        <Skeleton className="h-9 w-20 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
    )
  }

  const { href: authenticatedCreateHref } = resolveCreateEventCtaState({ authenticated: true })
  const createEventHref = authenticated ? authenticatedCreateHref : anonymousCreateHref

  return (
    <div className="flex items-center gap-2">
      {authenticated ? (
        <Button
          variant="outline"
          size="sm"
          asChild
          className="border-primary/40 text-foreground transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <a href="/dashboard">{t.dashboard}</a>
        </Button>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-primary/40 text-foreground transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden"
          >
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="hidden text-foreground transition hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex"
          >
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>
        </>
      )}

      <Button
        size="sm"
        asChild
        className="cta-primary flex-shrink-0 whitespace-nowrap rounded-lg font-semibold"
      >
        <a href={createEventHref}>{t.createRoom}</a>
      </Button>
    </div>
  )
}
