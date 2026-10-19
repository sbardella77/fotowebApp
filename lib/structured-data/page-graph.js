import { getOrganizationNode } from './organization'
import { getWebsiteNode } from './website'
import { getWebPageNode } from './webpage'
import { getFaqPageNode } from './faq'

/**
 * Assemble the full JSON-LD @graph for one localized marketing page:
 * Organization + WebSite (repeated per page with stable @ids, not injected
 * globally — see Phase 1 architecture notes) + WebPage, plus an optional
 * FAQPage for the handful of pages that render visible FAQ content.
 *
 * `questions` is only passed for the five FAQ-eligible pages (pricing,
 * wedding, birthday, private-party, corporate-event); every other page
 * must call this without it and must not receive FAQPage schema.
 */
export function getMarketingPageGraph({ locale, path, name, description, questions }) {
  const organization = getOrganizationNode()
  const website = getWebsiteNode()

  const graph = [organization, website]

  if (questions && questions.length > 0) {
    const faqPage = getFaqPageNode({ locale, path, questions })
    const webPage = getWebPageNode({ locale, path, name, description, faqId: faqPage['@id'] })
    graph.push(webPage, faqPage)
  } else {
    const webPage = getWebPageNode({ locale, path, name, description })
    graph.push(webPage)
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}
