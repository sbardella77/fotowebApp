'use client'

import { Sparkles, Trash2 } from 'lucide-react'
import { UpsellRow } from '@/components/upsell-row'

export function EventWorkspaceSettings({
  event,
  plan,
  isAccountPremium,
  isWeddingProEvent,
  isProEvent,
  eventUpgradeUpsells,
  otherUpsells,
  effectivePlan,
  checkoutBusy,
  onUpgradeProEvent,
  onUpgradeWeddingPro,
  onUpgradeProfessional,
  retentionState,
  onDelete,
  t,
}) {
  return (
    <div>
      {/* Configuration / plan information */}
      <div className="space-y-3 rounded-xl border border-border bg-secondary p-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.eventUpgradeTitle ?? 'Event upgrades'}</p>
        {isAccountPremium ? (
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
              <Sparkles className="mr-1 h-3 w-3" />
              {t.coveredByProfessional ?? 'Covered by Professional'}
            </span>
          </div>
        ) : isWeddingProEvent ? (
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
              <Sparkles className="mr-1 h-3 w-3" />
              {t.eventPlanWeddingPro ?? t.weddingPro ?? 'Wedding Pro'}
            </span>
          </div>
        ) : (
          <>
            {eventUpgradeUpsells.map((upsell) => (
              <UpsellRow
                key={upsell.feature}
                upsell={upsell}
                t={t}
                onUpgrade={(plan, upsellType) => {
                  if (plan === 'pro_event') onUpgradeProEvent?.(upsellType)
                  if (plan === 'wedding_pro') onUpgradeWeddingPro?.(upsellType)
                }}
                checkoutBusy={checkoutBusy}
                source="dashboard_event_panel"
                eventSlug={event.slug}
                eventId={event.id}
                ownerPlan={plan}
                billingTier={event.billingTier}
                effectivePlan={effectivePlan}
              />
            ))}
            {eventUpgradeUpsells.length === 0 && (
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
                  <Sparkles className="mr-1 h-3 w-3" />
                  {isProEvent ? (t.eventPlanProEvent ?? t.proEvent ?? 'Pro Event') : (t.proEvent ?? 'Pro Event')}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3 space-y-3 rounded-xl border border-border bg-secondary p-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.planInfo ?? 'Plan'}</p>
        {otherUpsells.map((upsell) => (
          <UpsellRow
            key={upsell.feature}
            upsell={upsell}
            t={t}
            onUpgrade={(plan, upsellType) => {
              if (plan === 'professional') onUpgradeProfessional?.(upsellType)
            }}
            checkoutBusy={checkoutBusy}
            source="dashboard_event_panel"
            eventSlug={event.slug}
            eventId={event.id}
            ownerPlan={plan}
            billingTier={event.billingTier}
            effectivePlan={effectivePlan}
          />
        ))}
        {otherUpsells.length === 0 && (
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-accent-dark">
              <Sparkles className="mr-1 h-3 w-3" />
              {isAccountPremium ? (plan === 'business' ? (t.business ?? 'Business') : (t.professional ?? 'Professional')) : (event.billingTier === 'wedding_pro' ? t.weddingPro : t.proEvent)}
            </span>
          </div>
        )}
      </div>

      {/* Retention / storage */}
      <div className="mt-3 rounded-xl border border-border bg-secondary p-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.storageDuration ?? 'Storage duration'}</p>
        <div className="mt-2 text-sm text-muted-foreground">
          {retentionState.policy === 'professional_active' ? (
            <span>{t.storedWhileSubscriptionActive ?? 'Stored while your subscription is active.'}</span>
          ) : retentionState.retentionUntil ? (
            <span>
              {t.storedUntil ?? 'Photos stored until'}:{' '}
              <span className="font-medium text-foreground">
                {new Date(retentionState.retentionUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            </span>
          ) : (
            <span>{t.storedWhileSubscriptionActive ?? 'Stored while your subscription is active.'}</span>
          )}
        </div>
        {retentionState.isExpiringSoon && !retentionState.coveredByVault && (
          <div className="mt-2 text-xs text-amber-500">
            {t.storageExpiresSoon ?? 'Storage expires soon'}
          </div>
        )}
        {retentionState.canExtend && !retentionState.coveredByVault && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t.snaproomsVault ?? 'SnapRooms Vault'} — {t.comingSoon ?? 'Coming soon'}
          </div>
        )}
      </div>

      {/* Danger zone */}
      <div className="mt-6 border-t border-border pt-5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-destructive">{t.dangerZone ?? 'Danger zone'}</p>
        <button
          type="button"
          onClick={() => onDelete(event)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          {t.deleteRoomTitle}
        </button>
      </div>
    </div>
  )
}
