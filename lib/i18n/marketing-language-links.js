import { LOCALES, LOCALIZED_PUBLIC_PATHS, localizedPath } from './config'
import { getArticle, getArticleAlternates } from '@/lib/content/articles'

/** Public language destinations. Article slugs differ between translations. */
export function getMarketingLanguageLinks(pathname) {
  const segments = (pathname || '').replace(/\/$/, '').split('/')
  const locale = segments[1]
  if (!LOCALES.includes(locale)) return null

  const suffix = `/${segments.slice(2).join('/')}`
  if (LOCALIZED_PUBLIC_PATHS.includes(suffix)) {
    return Object.fromEntries(LOCALES.map((language) => [language, localizedPath(language, suffix)]))
  }

  const article = getArticle(locale, suffix.slice(1))
  if (!article) return null

  // Markets without this article land on their own homepage.
  return {
    ...Object.fromEntries(LOCALES.map((language) => [language, localizedPath(language)])),
    ...getArticleAlternates(article),
  }
}
