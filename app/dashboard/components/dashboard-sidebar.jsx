'use client'

import { useEffect } from 'react'
import { Camera, CreditCard, LayoutDashboard, LogOut, Sparkles, User, BarChart3, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackUpsellImpression, trackUpsellClick } from '@/lib/analytics/upsell'
import { useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'

export function DashboardSidebar({
  experience,
  email,
  onLogout,
  onUpgradeClick,
  canManageSubscription,
  onManageSubscription,
  portalBusy,
  t,
  tCommon,
}) {
  const locale = useLocale()
  const showAnalytics = experience?.sidebarItems?.includes('analytics')
  const showPricing = experience?.sidebarItems?.includes('pricing')
  const showSidebarUpsell = experience?.showSidebarUpsell && onUpgradeClick

  useEffect(() => {
    if (showSidebarUpsell && experience?.audience) {
      trackUpsellImpression({
        upsellType: 'professional_account',
        source: 'dashboard_sidebar',
        location: 'dashboard',
        ownerPlan: experience?.audience,
        effectivePlan: experience?.audience,
        ctaPlan: 'professional',
      })
    }
  }, [showSidebarUpsell, experience?.audience])

  const handleUpgradeClick = () => {
    trackUpsellClick({
      upsellType: 'professional_account',
      source: 'dashboard_sidebar',
      location: 'dashboard',
      ownerPlan: experience?.audience,
      effectivePlan: experience?.audience,
      ctaPlan: 'professional',
    })
    onUpgradeClick?.()
  }

  const getSidebarUpsellCopy = () => {
    switch (experience?.audience) {
      case 'event_pro':
      case 'wedding_pro':
        return { title: t.createMoreEvents, description: t.sidebarUpsellProDesc }
      case 'consumer':
      default:
        return { title: t.unlockPremium, description: t.upgradeDesc }
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-subtle">
          <Camera className="h-[18px] w-[18px]" />
        </div>
        <span className="font-display text-[15px] font-bold tracking-tight text-foreground">{t.brand}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          <a
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-medium text-foreground"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t.dashboard ?? 'Dashboard'}
          </a>
          {showAnalytics && (
            <a
              href="/dashboard/analytics"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-primary/5 hover:text-foreground transition-colors"
            >
              <BarChart3 className="h-4 w-4" />
              {t.analyticsTitle ?? 'Analytics'}
            </a>
          )}
          {showPricing && (
            <a
              href={`${localizedPath(locale, '/pricing')}?from=dashboard`}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-primary/5 hover:text-foreground transition-colors"
            >
              <Tag className="h-4 w-4" />
              {tCommon.viewPricing ?? 'Pricing'}
            </a>
          )}
        </div>

        {showSidebarUpsell && (
          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-dark" />
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.premium}</span>
            </div>
            {(() => {
              const copy = getSidebarUpsellCopy()
              return (
                <>
                  <p className="mt-2 text-sm font-medium text-foreground">{copy.title}</p>
                  <p className="mt-1 text-xs font-light text-muted-foreground leading-relaxed">{copy.description}</p>
                </>
              )
            })()}
            <Button size="sm" className="mt-3 w-full cta-primary" onClick={handleUpgradeClick}>
              {t.startProfessional}
            </Button>
          </div>
        )}
      </nav>

      {/* Owner / Profile */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg bg-raised px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-accent-dark">
            <User className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{email || 'Owner'}</p>
            <p className="truncate text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              {(() => {
                switch (experience?.planBadge?.plan) {
                  case 'professional':
                    return t.accountPlanProfessional || t.professional || 'Professional'
                  case 'business':
                    return t.accountPlanBusiness || t.business || 'Business'
                  case 'pro':
                    return t.proBadge || 'Pro'
                  default:
                    return t.accountPlanFree || t.freePlan || 'Free'
                }
              })()}
            </p>
          </div>
        </div>
        {canManageSubscription && (
          <button
            type="button"
            onClick={onManageSubscription}
            disabled={portalBusy}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-raised hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <CreditCard className="h-4 w-4" />
            {portalBusy ? t.openingBillingPortal : t.manageSubscription}
          </button>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-raised hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          {t.signOut}
        </button>
      </div>
    </div>
  )
}
