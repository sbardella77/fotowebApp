'use client'

import { Camera } from 'lucide-react'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { trackEvent } from '@/lib/analytics/track-client'
import { EVENT_PRICING_LINK_CLICKED } from '@/lib/analytics/events'
import { AuthAwareNavActions } from '@/components/auth-aware-nav-actions'
import { AuthAwareCreateEventCta } from '@/components/auth-aware-create-event-cta'

export function MarketingNav({ variant = 'fixed' }) {
  const t = useTranslations('nav')
  const locale = useLocale()

  const navClass =
    variant === 'fixed'
      ? 'fixed top-0 left-0 right-0 z-50'
      : 'relative'

  return (
    <nav className={`${navClass} bg-background/85 backdrop-blur-2xl border-b border-border sm:bg-background/70`}>
      <div className="container flex h-16 items-center justify-between px-4">
        <a href="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow transition-transform group-hover:scale-105">
            <Camera className="h-[18px] w-[18px]" />
          </div>
          <span className="font-display text-[15px] font-bold tracking-tight text-foreground">
            SnapRooms
          </span>
        </a>

        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="/pricing"
            className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            onClick={() => {
              trackEvent(EVENT_PRICING_LINK_CLICKED, { source: 'landing_nav', locale, location: 'marketing_nav' })
            }}
          >
            {t.pricing}
          </a>
          <a
            href="/for-wedding-photographers"
            className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline"
          >
            {t.forPhotographers}
          </a>
          <a
            href="/for-event-planners"
            className="hidden px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground lg:inline"
          >
            {t.forPlanners}
          </a>

          <div className="mx-1 hidden h-4 w-px bg-border sm:block" />

          <LanguageSwitcher />

          <AuthAwareNavActions />

          <AuthAwareCreateEventCta
            t={t}
            className="cta-primary font-semibold flex-shrink-0 whitespace-nowrap"
          />
        </div>
      </div>
    </nav>
  )
}
