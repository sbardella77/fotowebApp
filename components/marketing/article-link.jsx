import { ArrowRight } from 'lucide-react'
import { localizedPath } from '@/lib/i18n/config'
import { getArticleForTopic } from '@/lib/content/articles'

/**
 * In-body link from a marketing page to the guide on `topic` in this locale
 * (lib/content/articles.js). Renders nothing in locales without that article.
 */
export function ArticleLink({ locale, topic, className = '' }) {
  const article = getArticleForTopic(locale, topic)
  if (!article) return null
  return (
    <p className={`text-center text-sm ${className}`}>
      <a
        href={localizedPath(locale, `/${article.slug}`)}
        className="group inline-flex items-center gap-1.5 font-semibold text-accent-dark underline-offset-4 hover:underline"
      >
        <span className="text-muted-foreground">{article.eyebrow}:</span>
        {article.h1}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </a>
    </p>
  )
}
