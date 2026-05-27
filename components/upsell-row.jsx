'use client'

import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * UpsellRow — contextual, non-intrusive upsell card.
 *
 * Renders a benefit-oriented upsell block derived from lib/upsell-context.js.
 * Keeps the SnapRooms design system (primary/5 surfaces, cta-primary button).
 */
export function UpsellRow({ upsell, t, onUpgrade, checkoutBusy, size = 'sm' }) {
  if (!upsell) return null

  const hasCta = upsell.ctaKey && onUpgrade && upsell.ctaPlan

  return (
    <div className="rounded-lg border border-primary/10 bg-primary/5 p-3">
      <p className="text-xs font-semibold text-foreground">
        {t[upsell.titleKey] || upsell.titleKey}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {t[upsell.descriptionKey] || upsell.descriptionKey}
      </p>
      {upsell.benefitsKeys?.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {upsell.benefitsKeys.map((key) => (
            <li key={key} className="text-[11px] text-accent-dark flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" />
              {t[key] || key}
            </li>
          ))}
        </ul>
      )}
      {hasCta && (
        <Button
          size={size}
          className="mt-2 w-full cta-primary"
          disabled={checkoutBusy}
          onClick={() => onUpgrade(upsell.ctaPlan)}
        >
          {checkoutBusy ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            t[upsell.ctaKey] || upsell.ctaKey
          )}
        </Button>
      )}
    </div>
  )
}
