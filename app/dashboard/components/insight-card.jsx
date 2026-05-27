'use client'

import { ImagePlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'

export function InsightCard({ plan, events, checkoutBusy, onUpgrade, t }) {
  const { isPremium } = resolveEffectiveEventAccessState({ ownerPlan: plan })
  const totalPhotos = events.reduce((sum, e) => sum + (e.photoCount || e.photos?.length || 0), 0)

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-subtle">
      <div className="p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
                <ImagePlus className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-lg font-bold tracking-tight text-foreground">
                  {events.length} {events.length === 1 ? (t.roomSingular ?? 'Room') : (t.roomsLabel ?? 'Rooms')}
                </p>
                <p className="text-xs font-light text-muted-foreground">
                  {totalPhotos} {totalPhotos === 1 ? (t.photoSingular ?? 'Photo') : (t.photosLabel ?? 'Photos')}
                </p>
              </div>
            </div>
          </div>

          {!isPremium ? (
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.premium}</span>
                <Sparkles className="h-3 w-3 text-accent-dark" />
              </div>
              <p className="text-sm font-light text-muted-foreground">{t.upgradeDesc}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" asChild className="border-border bg-surface text-foreground">
                  <a href="/pricing?from=dashboard">{t.viewPricing}</a>
                </Button>
                <Button size="sm" className="cta-primary" disabled={checkoutBusy} onClick={onUpgrade}>
                  {checkoutBusy ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : t.startProfessional}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-accent-dark">
              <Sparkles className="h-3.5 w-3.5" />
              {t.premiumActive ?? 'Premium active'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
