'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOwnerSession } from '@/lib/use-owner-session'
import { resolveCreateEventCtaState } from '@/lib/create-event-cta-state'

export function AuthAwareCreateEventCta({ t, className }) {
  const { authenticated, loading } = useOwnerSession()

  if (loading) {
    return <Skeleton className="h-9 w-24" />
  }

  const { href } = resolveCreateEventCtaState({ authenticated })

  return (
    <Button size="sm" asChild className={className}>
      <a href={href}>{t.createRoom}</a>
    </Button>
  )
}
