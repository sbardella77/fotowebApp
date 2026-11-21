import { localizedPath } from '@/lib/i18n/config'
import { BASE_URL, ORGANIZATION_ID } from './constants'

/**
 * Article node for one editorial page (lib/content/articles.js), linked to
 * the page's WebPage node. Author and publisher are the Organization: the
 * guides are written by SnapRooms, not by a named person.
 */
export function getArticleNode({ article }) {
  const url = `${BASE_URL}${localizedPath(article.locale, `/${article.slug}`)}`
  return {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: article.h1,
    description: article.description,
    inLanguage: article.locale,
    // Google's Article check flags date-only values: send a full ISO 8601
    // date-time with a time zone (the articles only record the day).
    datePublished: `${article.published}T00:00:00+00:00`,
    dateModified: `${article.updated}T00:00:00+00:00`,
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    mainEntityOfPage: { '@id': `${url}#webpage` },
    image: `${BASE_URL}/${article.locale}/opengraph-image`,
  }
}
