import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { safeJsonLdStringify } from '@/lib/structured-data/serialize'
import { collectFaqPairs } from '@/lib/structured-data/faq'
import { JSONLD_PAGES } from './jsonld-pages.fixture'

function buildGraph(locale, page) {
  const t = getDictionary(locale)
  const [name, description] = page.getNameDescription(t)
  const questions = page.faq
    ? collectFaqPairs(t[page.faq.namespaceKey], page.faq.prefix, page.faq.count)
    : undefined
  return getMarketingPageGraph({ locale, path: page.path, name, description, questions })
}

describe('JSON-LD is valid, round-trippable JSON for every public marketing page x locale', () => {
  it('covers all 66 path x locale combinations', () => {
    expect(JSONLD_PAGES.length * LOCALES.length).toBe(66)
  })

  describe.each(JSONLD_PAGES.map((p) => p.path))('%s', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)

    it.each(LOCALES)('locale %s: safeJsonLdStringify output parses back to a deep-equal object', (locale) => {
      const graph = buildGraph(locale, page)
      const serialized = safeJsonLdStringify(graph)
      expect(() => JSON.parse(serialized)).not.toThrow()
      expect(JSON.parse(serialized)).toEqual(graph)
    })

    it.each(LOCALES)('locale %s: graph has @context and a non-empty @graph array', (locale) => {
      const graph = buildGraph(locale, page)
      expect(graph['@context']).toBe('https://schema.org')
      expect(Array.isArray(graph['@graph'])).toBe(true)
      expect(graph['@graph'].length).toBeGreaterThan(0)
    })
  })
})
