'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { useOwnerSession } from '@/lib/use-owner-session'

/**
 * Auth-aware final CTA section for the pricing page.
 *
 * Authenticated owners see a single primary action to go to the dashboard.
 * Anonymous visitors see the public dual-action: create free room + sign in.
 */
export function AuthAwareFinalCta() {
  const t = useTranslations('pricing')
  const locale = useLocale()
  const { loading, authenticated } = useOwnerSession()

  if (loading) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Skeleton className="h-12 w-full rounded-xl sm:w-48" />
        <Skeleton className="h-12 w-full rounded-xl sm:w-48" />
      </div>
    )
  }

  if (authenticated) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button size="lg" className="cta-primary rounded-xl w-full sm:w-auto" asChild>
          <a href="/dashboard">{t.pricingGoToDashboard}</a>
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
      <Button size="lg" className="cta-primary rounded-xl w-full sm:w-auto" asChild>
        <a href={localizedPath(locale, '/')}>{t.createFreeRoom}</a>
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="rounded-xl w-full sm:w-auto border-primary/40 bg-transparent px-8 text-base font-semibold text-foreground transition hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        asChild
      >
        <a href="/dashboard/login">{t.signInToUpgrade}</a>
      </Button>
    </div>
  )
}
