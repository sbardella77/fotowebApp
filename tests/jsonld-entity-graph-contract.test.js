import { describe, it, expect } from 'vitest'
import { LOCALES, localizedPath } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { collectFaqPairs } from '@/lib/structured-data/faq'
import { BASE_URL, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/structured-data/constants'
import { JSONLD_PAGES } from './jsonld-pages.fixture'

function buildGraph(locale, page) {
  const t = getDictionary(locale)
  const [name, description] = page.getNameDescription(t)
  const questions = page.faq
    ? collectFaqPairs(t[page.faq.namespaceKey], page.faq.prefix, page.faq.count)
    : undefined
  return getMarketingPageGraph({ locale, path: page.path, name, description, questions })
}

function findNode(graph, type) {
  return graph['@graph'].find((node) => node['@type'] === type)
}

describe('Organization and WebSite @ids are stable and locale-invariant', () => {
  it.each(JSONLD_PAGES.map((p) => p.path))('%s: every locale emits the same Organization/WebSite @id', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)
    for (const locale of LOCALES) {
      const graph = buildGraph(locale, page)
      const org = findNode(graph, 'Organization')
      const site = findNode(graph, 'WebSite')
      expect(org['@id']).toBe(ORGANIZATION_ID)
      expect(site['@id']).toBe(WEBSITE_ID)
      expect(org['@id']).toBe(`${BASE_URL}/#organization`)
      expect(site['@id']).toBe(`${BASE_URL}/#website`)
    }
  })

  it('never fabricates Organization.legalName, sameAs, reviews, or ratings', () => {
    const graph = buildGraph('en', JSONLD_PAGES[0])
    const org = findNode(graph, 'Organization')
    expect(org.legalName).toBeUndefined()
    expect(org.sameAs).toBeUndefined()
    expect(org.aggregateRating).toBeUndefined()
    expect(org.review).toBeUndefined()
  })

  it('WebSite.publisher references Organization by @id, not an inlined duplicate', () => {
    const graph = buildGraph('en', JSONLD_PAGES[0])
    const site = findNode(graph, 'WebSite')
    expect(site.publisher).toEqual({ '@id': ORGANIZATION_ID })
  })
})

describe('WebPage url/@id/inLanguage are consistent with the canonical URL scheme', () => {
  describe.each(JSONLD_PAGES.map((p) => p.path))('%s', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)

    it.each(LOCALES)('locale %s: WebPage.url matches localizedPath(), @id is url#webpage, inLanguage is the locale', (locale) => {
      const graph = buildGraph(locale, page)
      const webPage = findNode(graph, 'WebPage')
      const expectedUrl = `${BASE_URL}${localizedPath(locale, page.path)}`
      expect(webPage.url).toBe(expectedUrl)
      expect(webPage['@id']).toBe(`${expectedUrl}#webpage`)
      expect(webPage.inLanguage).toBe(locale)
      expect(webPage.isPartOf).toEqual({ '@id': WEBSITE_ID })
    })
  })
})

describe('no pricing or Stripe data leaks into the structured-data module (Phase 1 keeps Offer/pricing out)', () => {
  it('lib/structured-data source contains no currency symbols or Stripe references', async () => {
    const { readFileSync, readdirSync } = await import('fs')
    const { resolve, join } = await import('path')
    const dir = resolve(import.meta.dirname, '..', 'lib/structured-data')
    for (const entry of readdirSync(dir)) {
      const source = readFileSync(join(dir, entry), 'utf8')
      expect(source).not.toMatch(/€|STRIPE_PRICE|stripe/i)
    }
  })
})
