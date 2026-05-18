'use client'

import { Camera, LayoutDashboard, LogOut, Sparkles, User } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DashboardSidebar({ plan, email, onLogout, onUpgradeClick, t, tCommon }) {
  const isPremium = plan === 'professional' || plan === 'business' || plan === 'pro'

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-subtle">
          <Camera className="h-[18px] w-[18px]" />
        </div>
        <span className="font-display text-[15px] font-bold tracking-tight text-accent-dark">{t.brand}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          <a
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-medium text-accent-dark"
          >
            <LayoutDashboard className="h-4 w-4" />
            {t.dashboard ?? 'Dashboard'}
          </a>
        </div>

        {!isPremium && onUpgradeClick && (
          <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-dark" />
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.premium}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{t.unlockPremium}</p>
            <p className="mt-1 text-xs font-light text-muted-foreground leading-relaxed">{t.upgradeDesc}</p>
            <Button size="sm" className="mt-3 w-full cta-primary" onClick={onUpgradeClick}>
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
              {isPremium ? (t.proBadge || 'Pro') : (t.freePlan || 'Free')}
            </p>
          </div>
        </div>
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
