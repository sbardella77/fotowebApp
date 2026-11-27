'use client'

import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath, LOCALE_LABELS } from '@/lib/i18n/config'
import { usePathname } from 'next/navigation'
import { getMarketingLanguageLinks } from '@/lib/i18n/marketing-language-links'
import { InstallCta } from '@/components/install-cta'
import { SnapRoomsLogo } from '@/components/marketing/logo'
import { OPEN_PREFERENCES_EVENT } from '@/components/cookie-consent-banner'
import { getArticlesForLocale, ARTICLE_SECTION_LABEL } from '@/lib/content/articles'

export function MarketingFooter() {
  const t = useTranslations('footer')
  const locale = useLocale()
  const languageLinks = getMarketingLanguageLinks(usePathname())
  const articles = getArticlesForLocale(locale)

  return (
    <footer className="border-t border-border">
      <div className="container px-4 py-14">
        <div className="mx-auto max-w-5xl">
          <div className={`grid gap-10 sm:grid-cols-2 ${articles.length > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
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

            {articles.length > 0 && (
              <div>
                <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ARTICLE_SECTION_LABEL[locale]}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {articles.map((a) => (
                    <li key={a.slug}><a href={localizedPath(locale, `/${a.slug}`)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{a.navLabel}</a></li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </p>
              <ul className="mt-4 space-y-2.5">
                <li><a href={localizedPath(locale, '/privacy')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.privacy}</a></li>
                <li><a href={localizedPath(locale, '/terms')} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.terms}</a></li>
                <li>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT))}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t.cookiePreferences}
                  </button>
                </li>
                <li><a href="/dashboard/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">{t.organizerSignIn}</a></li>
              </ul>
            </div>
          </div>

          {languageLinks && (
            <nav aria-label="Languages" className="mt-10 flex flex-wrap justify-center gap-x-5 gap-y-3 border-t border-border pt-8">
              {Object.entries(languageLinks).map(([language, href]) => (
                <a key={language} href={href} hrefLang={language} lang={language}
                  aria-current={language === locale ? 'page' : undefined}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  {LOCALE_LABELS[language]}
                </a>
              ))}
            </nav>
          )}

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
