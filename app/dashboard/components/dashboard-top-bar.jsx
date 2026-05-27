'use client'

import { CheckCircle2, Sparkles } from 'lucide-react'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'

export function DashboardTopBar({ plan, message, onDismissMessage }) {
  const { isPremium } = resolveEffectiveEventAccessState({ ownerPlan: plan })

  return (
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-3">
        {/* Plan pill */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
            isPremium
              ? 'border-primary/30 bg-primary/10 text-accent-dark'
              : 'border-border bg-secondary text-foreground'
          }`}
        >
          {isPremium && <Sparkles className="h-3 w-3" />}
          {isPremium ? 'Pro' : 'Free'}
        </span>
      </div>

      {message && (
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-accent-dark shrink-0" />
          <span className="truncate max-w-[240px]">{message}</span>
          {onDismissMessage && (
            <button type="button" onClick={onDismissMessage} className="ml-1 text-muted-foreground hover:text-foreground">
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}
