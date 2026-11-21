import { ArrowRight } from 'lucide-react'
import { localizedPath } from '@/lib/i18n/config'
import { getArticlesForLocale, ARTICLE_SECTION_LABEL } from '@/lib/content/articles'

/**
 * Text links to the guides of one locale, for use inside a landing page body.
 * Data comes from lib/content/articles.js, so the same guides appear in the
 * footer, the sitemap and llms.txt. Renders nothing for a locale without guides.
 */
export function GuideLinks({ locale }) {
  const articles = getArticlesForLocale(locale)
  if (articles.length === 0) return null
  const label = ARTICLE_SECTION_LABEL[locale]

  return (
    <section aria-label={label} className="border-t border-border py-12 sm:py-16">
      <div className="container px-4">
        <p className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {articles.map((a) => (
            <li key={a.slug}>
              <a
                href={localizedPath(locale, `/${a.slug}`)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4 text-sm font-medium text-foreground transition-colors hover:border-primary"
              >
                <span>{a.navLabel}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
