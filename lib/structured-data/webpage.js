import { localizedPath } from '@/lib/i18n/config'
import { BASE_URL, WEBSITE_ID } from './constants'

/**
 * WebPage node for one localized marketing page. The URL is built from the
 * same localizedPath() helper that app/sitemap.js and every page's own
 * generateMetadata() canonical/hreflang block already use, so the JSON-LD
 * url can never drift from the canonical URL the page itself declares.
 *
 * `path` matches the LOCALIZED_PUBLIC_PATHS convention: '/' for the home
 * page, '/pricing' for the pricing page, etc.
 */
export function getWebPageNode({ locale, path, name, description, faqId }) {
  const url = `${BASE_URL}${localizedPath(locale, path)}`
  const node = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: locale,
    isPartOf: { '@id': WEBSITE_ID },
  }
  if (faqId) {
    node.mainEntity = { '@id': faqId }
  }
  return node
}
