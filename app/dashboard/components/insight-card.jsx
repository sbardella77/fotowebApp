'use client'

import { useEffect, useRef } from 'react'
import { ImagePlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'

export function InsightCard({ experience, events, checkoutBusy, onUpgrade, t }) {
  const upsellStrategy = experience?.upsellStrategy || 'light'
  const showUpgradeBanner = experience?.insight?.showUpgradeBanner ?? true
  const totalPhotos = events.reduce((sum, e) => sum + (e.photoCount || e.photos?.length || 0), 0)
  const tracked = useRef(false)

  useEffect(() => {
    if (showUpgradeBanner && !tracked.current) {
      tracked.current = true
      trackUpsellImpression({
        upsellType: 'professional_account',
        source: 'dashboard_insight_card',
        location: 'dashboard',
        ownerPlan: experience?.audience,
        effectivePlan: experience?.audience,
        ctaPlan: 'professional',
      })
    }
  }, [showUpgradeBanner, experience?.audience])

  const handleUpgrade = () => {
    trackUpsellClick({
      upsellType: 'professional_account',
      source: 'dashboard_insight_card',
      location: 'dashboard',
      ownerPlan: experience?.audience,
      effectivePlan: experience?.audience,
      ctaPlan: 'professional',
    })
    onUpgrade?.()
  }

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

          {showUpgradeBanner ? (
            <div className="flex flex-col items-start gap-3 sm:items-end">
              {upsellStrategy === 'feature_oriented' ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.premium}</span>
                    <Sparkles className="h-3 w-3 text-accent-dark" />
                  </div>
                  <p className="text-sm font-light text-muted-foreground">{t.upgradeDesc}</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/5 px-2 py-0.5 text-[11px] text-accent-dark">{t.upsellBenefitUnlimitedRooms}</span>
                    <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/5 px-2 py-0.5 text-[11px] text-accent-dark">{t.upsellBenefitZipDownload}</span>
                    <span className="inline-flex items-center rounded-full border border-primary/10 bg-primary/5 px-2 py-0.5 text-[11px] text-accent-dark">{t.upsellBenefitPrivateDelivery}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.premium}</span>
                    <Sparkles className="h-3 w-3 text-accent-dark" />
                  </div>
                  <p className="text-sm font-light text-muted-foreground">{t.upgradeDesc}</p>
                </>
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" asChild className="border-border bg-surface text-foreground">
                  <a href="/pricing?from=dashboard">{t.viewPricing}</a>
                </Button>
                <Button size="sm" className="cta-primary" disabled={checkoutBusy} onClick={handleUpgrade}>
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
