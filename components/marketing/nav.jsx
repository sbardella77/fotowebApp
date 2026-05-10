'use client'

import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useTranslations } from '@/components/i18n-provider'

export function MarketingNav({ variant = 'fixed' }) {
  const t = useTranslations('nav')

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

          {/* Mobile Sign In — outline button for clear visibility & touch target */}
          <Button
            size="sm"
            variant="outline"
            asChild
            className="h-9 px-2.5 text-sm font-semibold sm:hidden flex-shrink-0"
          >
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>

          {/* Desktop Sign In — ghost button */}
          <Button
            size="sm"
            variant="ghost"
            asChild
            className="hidden sm:inline-flex text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <a href="/dashboard/login">{t.signIn}</a>
          </Button>

          <Button
            size="sm"
            asChild
            className="cta-primary font-semibold flex-shrink-0 whitespace-nowrap"
          >
            <a href="/">{t.createRoom}</a>
          </Button>
        </div>
      </div>
    </nav>
  )
}
