'use client'

import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { InstallCta } from '@/components/install-cta'
import { SnapRoomsLogo } from '@/components/marketing/logo'

export function MarketingFooter() {
  const t = useTranslations('footer')
  const locale = useLocale()

  return (
    <footer className="border-t border-border">
      <div className="container px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <SnapRoomsLogo href={localizedPath(locale, '/')} size="sm" />
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {t.tagline}
              </p>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Product
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href={localizedPath(locale, '/pricing')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.pricing}</a></li>
                <li><a href={localizedPath(locale, '/wedding-photo-sharing')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.weddings}</a></li>
                <li><a href={localizedPath(locale, '/birthday-photo-sharing')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.birthdays}</a></li>
                <li><a href={localizedPath(locale, '/private-party-photo-sharing')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.privateParty}</a></li>
                <li><a href={localizedPath(locale, '/corporate-event-photo-sharing')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.corporate}</a></li>
              </ul>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Professionals
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href={localizedPath(locale, '/for-wedding-photographers')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.forPhotographers}</a></li>
                <li><a href={localizedPath(locale, '/for-event-planners')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.forPlanners}</a></li>
                <li><a href={localizedPath(locale, '/commercial-license')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.commercialLicense}</a></li>
              </ul>
            </div>

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href={localizedPath(locale, '/privacy')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.privacy}</a></li>
                <li><a href={localizedPath(locale, '/terms')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.terms}</a></li>
                <li><a href="/dashboard/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.organizerSignIn}</a></li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
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
