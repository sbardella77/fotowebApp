'use client'

import { Camera } from 'lucide-react'
import { useTranslations } from '@/components/i18n-provider'
import { InstallCta } from '@/components/install-cta'

export function MarketingFooter() {
  const t = useTranslations('footer')

  return (
    <footer className="border-t border-white/[0.06]">
      <div className="container px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <a href="/" className="flex items-center gap-2.5 group">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow transition-transform group-hover:scale-105">
                  <Camera className="h-4 w-4" />
                </div>
                <span className="font-display text-sm font-bold tracking-tight text-foreground">
                  SnapRooms
                </span>
              </a>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {t.tagline}
              </p>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Product
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href="/pricing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.pricing}</a></li>
                <li><a href="/wedding-photo-sharing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.weddings}</a></li>
                <li><a href="/birthday-photo-sharing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.birthdays}</a></li>
                <li><a href="/corporate-event-photo-sharing" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.corporate}</a></li>
              </ul>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Professionals
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href="/for-wedding-photographers" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.photographers}</a></li>
                <li><a href="/for-event-planners" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.planners}</a></li>
                <li><a href="/commercial-license" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.commercialLicense}</a></li>
              </ul>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href="/privacy" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.privacy}</a></li>
                <li><a href="/terms" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.terms}</a></li>
                <li><a href="/dashboard/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.organizerSignIn}</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-8 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} SnapRooms. All rights reserved.
            </p>
            <InstallCta mode="landing" className="w-full sm:w-auto" />
          </div>
        </div>
      </div>
    </footer>
  )
}
