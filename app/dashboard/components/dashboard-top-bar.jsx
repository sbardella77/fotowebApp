'use client'

import { CheckCircle2, Sparkles } from 'lucide-react'
import { useTranslations } from '@/components/i18n-provider'

export function DashboardTopBar({ experience, message, onDismissMessage }) {
  const t = useTranslations('dashboard')
  const badge = experience?.planBadge
  const isPremium = badge?.variant === 'premium' || badge?.variant === 'pro'
  const planBadgeLabel = (() => {
    switch (badge?.plan) {
      case 'professional':
        return t?.accountPlanProfessional || t?.professional || 'Professional'
      case 'business':
        return t?.accountPlanBusiness || t?.business || 'Business'
      case 'pro':
        return t?.proBadge || 'Pro'
      default:
        return t?.accountPlanFree || t?.freePlan || 'Free'
    }
  })()

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex shrink-0 items-center gap-3">
        {/* Plan pill — never shrinks; it's short and always meaningful */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
            isPremium
              ? 'border-primary/30 bg-primary/10 text-accent-dark'
              : 'border-border bg-secondary text-foreground'
          }`}
        >
          {isPremium && <Sparkles className="h-3 w-3" />}
          {planBadgeLabel}
        </span>
      </div>

      {message && (
        // min-w-0 is required here: flex items default to min-width:auto, so
        // without it the child's `truncate` never gets a chance to apply —
        // this container can report an intrinsic width wider than the
        // available row, which is what caused the 320px page overflow.
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-dark" />
          <span className="min-w-0 flex-1 truncate">{message}</span>
          {onDismissMessage && (
            <button type="button" onClick={onDismissMessage} className="ml-1 shrink-0 text-muted-foreground hover:text-foreground">
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}
