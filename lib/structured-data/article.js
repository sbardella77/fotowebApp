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
    datePublished: article.published,
    dateModified: article.updated,
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
    mainEntityOfPage: { '@id': `${url}#webpage` },
    image: `${BASE_URL}/${article.locale}/opengraph-image`,
  }
}
