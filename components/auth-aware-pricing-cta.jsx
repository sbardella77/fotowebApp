'use client'

import { Button } from '@/components/ui/button'
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
 *  - variant: 'primary' | 'outline'
 *  - size: 'sm' | 'lg' | 'default'
 *  - className: additional classes
 *  - showHelper: when true and intent is event-level, shows a small hint
 *    telling authenticated owners to pick an event in the dashboard.
 */
export function AuthAwarePricingCta({
  intent = 'generic',
  variant = 'primary',
  size = 'sm',
  className = '',
  showHelper = false,
}) {
  const t = useTranslations('pricing')
  const { loading, authenticated } = useOwnerSession()

  if (loading) {
    return (
      <Button variant={variant} size={size} className={className} disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
      </Button>
    )
  }

  const { labelKey, href, helperKey } = resolvePricingCtaState({ authenticated, intent })

  return (
    <div className={helperKey ? 'space-y-2' : undefined}>
      <Button variant={variant} size={size} className={className} asChild>
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
