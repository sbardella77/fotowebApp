'use client'

import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackUpsellImpression, trackUpsellClick, resolveUpsellType } from '@/lib/analytics/upsell'

/**
 * UpsellRow — contextual, non-intrusive upsell card.
 *
 * Renders a benefit-oriented upsell block derived from lib/upsell-context.js.
 * Keeps the SnapRooms design system (primary/5 surfaces, cta-primary button).
 *
 * Analytics props (all optional but recommended):
 *   source, eventSlug, eventId, ownerPlan, billingTier, effectivePlan
 */
export function UpsellRow({ upsell, t, onUpgrade, checkoutBusy, size = 'sm', source, eventSlug, eventId, ownerPlan, billingTier, effectivePlan }) {
  if (!upsell) return null

  const hasCta = upsell.ctaKey && onUpgrade && upsell.ctaPlan
  const rowRef = useRef(null)
  const hasTracked = useRef(false)

  useEffect(() => {
    if (!rowRef.current || !source || hasTracked.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          hasTracked.current = true
          trackUpsellImpression({
            upsellType: resolveUpsellType(upsell.feature),
            source,
            eventSlug,
            eventId,
            ownerPlan,
            billingTier,
            effectivePlan,
            ctaPlan: upsell.ctaPlan,
          })
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(rowRef.current)
    return () => observer.disconnect()
  }, [source, eventSlug, eventId, ownerPlan, billingTier, effectivePlan, upsell.feature, upsell.ctaPlan])

  const handleClick = () => {
    if (source) {
      trackUpsellClick({
        upsellType: resolveUpsellType(upsell.feature),
        source,
        eventSlug,
        eventId,
        ownerPlan,
        billingTier,
        effectivePlan,
        ctaPlan: upsell.ctaPlan,
      })
    }
    onUpgrade?.(upsell.ctaPlan, resolveUpsellType(upsell.feature))
  }

  return (
    <div ref={rowRef} className="rounded-lg border border-primary/10 bg-primary/5 p-3">
      <p className="text-xs font-semibold text-foreground">
        {t[upsell.titleKey] || ''}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {t[upsell.descriptionKey] || ''}
      </p>
      {upsell.benefitsKeys?.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {upsell.benefitsKeys.map((key) => (
            <li key={key} className="text-[11px] text-accent-dark flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" />
              {t[key] || ''}
            </li>
          ))}
        </ul>
      )}
      {hasCta && (
        <Button
          size={size}
          className="mt-2 w-full cta-primary"
          disabled={checkoutBusy}
          onClick={handleClick}
        >
          {checkoutBusy ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            t[upsell.ctaKey] || ''
          )}
        </Button>
      )}
    </div>
  )
}
