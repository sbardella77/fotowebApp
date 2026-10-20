import { BASE_URL, WEBSITE_ID, ORGANIZATION_ID } from './constants'

/**
 * WebSite node. @id is stable and locale-invariant: SnapRooms is a single
 * property with six language variants, not six separate websites. Per-page
 * locale is expressed on the WebPage node's inLanguage, not here.
 */
export function getWebsiteNode() {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: 'SnapRooms',
    url: BASE_URL,
    publisher: { '@id': ORGANIZATION_ID },
  }
}
