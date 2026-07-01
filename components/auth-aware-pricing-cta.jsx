'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTranslations } from '@/components/i18n-provider'
import { useOwnerSession } from '@/lib/use-owner-session'
import { resolvePricingCtaState } from '@/lib/pricing-cta-state'
import { Loader2 } from 'lucide-react'

/**
 * Auth-aware CTA for pricing cards and inline pricing actions.
 *
 * Renders a Dashboard-aware button for authenticated owners and a
 * public sign-in/up upgrade CTA for anonymous visitors.
 *
 * Props:
 *  - intent: 'pro-event' | 'wedding-pro' | 'professional' | 'business' | 'free' | 'generic'
 *  - variant: 'primary' | 'outline' (kept for API compatibility; visual style is always brand CTA)
 *  - size: 'sm' | 'lg' | 'default'
 *  - className: additional classes
 *  - showHelper: when true and intent is event-level, shows a small hint
 *    telling authenticated owners to pick an event in the dashboard.
 */
export function AuthAwarePricingCta({
  intent = 'generic',
  variant = 'primary',
  size = 'default',
  className = '',
  showHelper = false,
  billingInterval = null,
}) {
  const t = useTranslations('pricing')
  const { loading, authenticated } = useOwnerSession()

  const buttonSize = size === 'sm' ? 'default' : size === 'lg' ? 'lg' : 'default'

  if (loading) {
    return (
      <div className={showHelper ? 'space-y-2' : undefined}>
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    )
  }

  const { labelKey, href, helperKey } = resolvePricingCtaState({ authenticated, intent, billingInterval })

  return (
    <div className={helperKey ? 'space-y-2' : undefined}>
      <Button
        variant="default"
        size={buttonSize}
        className={`w-full cta-primary rounded-xl border-transparent ${className}`}
        asChild
      >
        <a href={href}>{t[labelKey]}</a>
      </Button>
      {showHelper && helperKey && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t[helperKey]}
        </p>
      )}
    </div>
  )
}
