'use client'

import { LogIn } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { resolveCreateEventCtaState } from '@/lib/create-event-cta-state'

// authenticated/loading are lifted up to MarketingNav (which also needs them
// for the mobile Sheet menu's account entry) so the owner-session check
// happens exactly once per page load, not once per consumer.
export function AuthAwareNavActions({ t, anonymousCreateHref = '/', authenticated, loading }) {
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Skeleton className="h-10 w-10 rounded-lg sm:hidden" />
        <Skeleton className="hidden h-9 w-20 rounded-lg sm:block" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>
    )
  }

  const { href: authenticatedCreateHref } = resolveCreateEventCtaState({ authenticated: true })
  const createEventHref = authenticated ? authenticatedCreateHref : anonymousCreateHref

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
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
          {/* Mobile (below sm): always visible, icon-only. A full-text
              equivalent also lives in the Sheet menu (see nav.jsx) so
              sign-in is never exclusively behind the icon. Icon-only rather
              than icon+label across the whole mobile range keeps this
              robust against overflow at every width below `sm` — this row
              already carries Create Event + hamburger (+ language switcher
              from `sm` up), and a revealed text label was measured to
              overflow at several widths in that range. */}
          <Button
            variant="ghost"
            size="icon"
            asChild
            aria-label={t.signIn}
            className="flex-shrink-0 text-foreground transition hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:hidden"
          >
            <a href="/dashboard/login">
              <LogIn aria-hidden="true" />
            </a>
          </Button>
          {/* Desktop (sm and up): unchanged text-only button. */}
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
        className="cta-primary flex-shrink-0 whitespace-nowrap rounded-lg font-semibold px-2.5 sm:px-3"
      >
        <a href={createEventHref}>{t.createRoom}</a>
      </Button>
    </div>
  )
}
