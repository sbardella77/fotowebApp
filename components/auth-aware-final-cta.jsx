'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { useOwnerSession } from '@/lib/use-owner-session'
import { Loader2 } from 'lucide-react'

/**
 * Auth-aware final CTA section for the pricing page.
 *
 * Authenticated owners see a single primary action to go to the dashboard.
 * Anonymous visitors see the public dual-action: create free room + sign in.
 */
export function AuthAwareFinalCta() {
  const t = useTranslations('pricing')
  const { loading, authenticated } = useOwnerSession()

  if (loading) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" className="cta-primary" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      </div>
    )
  }

  if (authenticated) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" className="cta-primary" asChild>
          <a href="/dashboard">{t.pricingGoToDashboard}</a>
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Button size="lg" className="cta-primary" asChild>
        <a href="/">{t.createFreeRoom}</a>
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="border-border bg-transparent hover:bg-surface"
        asChild
      >
        <a href="/dashboard/login">{t.signInToUpgrade}</a>
      </Button>
    </div>
  )
}
