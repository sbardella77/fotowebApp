import { describe, it, expect } from 'vitest'
import { LOCALES } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
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

function findNode(graph, type) {
  return graph['@graph'].find((node) => node['@type'] === type)
}

const FAQ_PATHS = JSONLD_PAGES.filter((p) => p.faq).map((p) => p.path)
const NON_FAQ_PATHS = JSONLD_PAGES.filter((p) => !p.faq).map((p) => p.path)

describe('FAQPage schema appears only on the 5 pages that render visible FAQ content', () => {
  it('exactly 5 of the 11 pages are FAQ-eligible', () => {
    expect(FAQ_PATHS.length).toBe(5)
    expect(NON_FAQ_PATHS.length).toBe(6)
    expect(FAQ_PATHS.sort()).toEqual(
      [
        '/pricing',
        '/wedding-photo-sharing',
        '/birthday-photo-sharing',
        '/private-party-photo-sharing',
        '/corporate-event-photo-sharing',
      ].sort()
    )
  })

  it.each(NON_FAQ_PATHS)('%s never emits a FAQPage node, in any locale', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)
    for (const locale of LOCALES) {
      const graph = buildGraph(locale, page)
      expect(findNode(graph, 'FAQPage')).toBeUndefined()
    }
  })

  it.each(FAQ_PATHS)('%s emits a FAQPage node referenced from WebPage.mainEntity, in every locale', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)
    for (const locale of LOCALES) {
      const graph = buildGraph(locale, page)
      const faqPage = findNode(graph, 'FAQPage')
      const webPage = findNode(graph, 'WebPage')
      expect(faqPage).toBeDefined()
      expect(webPage.mainEntity).toEqual({ '@id': faqPage['@id'] })
      expect(faqPage['@id']).toBe(`${webPage.url}#faq`)
    }
  })
})

describe('FAQPage question/answer text matches the exact visible dictionary strings (no drift, no cross-locale leakage)', () => {
  it.each(FAQ_PATHS)('%s: every locale\'s FAQPage mainEntity exactly matches that locale\'s dictionary Q&A', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)
    for (const locale of LOCALES) {
      const t = getDictionary(locale)
      const expectedPairs = collectFaqPairs(t[page.faq.namespaceKey], page.faq.prefix, page.faq.count)
      const graph = buildGraph(locale, page)
      const faqPage = findNode(graph, 'FAQPage')

      expect(faqPage.mainEntity).toHaveLength(expectedPairs.length)
      expectedPairs.forEach((pair, i) => {
        expect(faqPage.mainEntity[i].name).toBe(pair.q)
        expect(faqPage.mainEntity[i].acceptedAnswer.text).toBe(pair.a)
        expect(typeof pair.q).toBe('string')
        expect(pair.q.length).toBeGreaterThan(0)
        expect(typeof pair.a).toBe('string')
        expect(pair.a.length).toBeGreaterThan(0)
      })
    }
  })

  it.each(FAQ_PATHS)('%s: FAQPage never contains an undefined/empty question or answer, in any locale', (path) => {
    const page = JSONLD_PAGES.find((p) => p.path === path)
    for (const locale of LOCALES) {
      const graph = buildGraph(locale, page)
      const faqPage = findNode(graph, 'FAQPage')
      for (const question of faqPage.mainEntity) {
        expect(question.name).toBeTruthy()
        expect(question.acceptedAnswer.text).toBeTruthy()
      }
    }
  })

  it('a DE page never contains an EN dictionary string (cross-locale leakage guard, sampled on /wedding-photo-sharing)', () => {
    const page = JSONLD_PAGES.find((p) => p.path === '/wedding-photo-sharing')
    const enGraph = buildGraph('en', page)
    const deGraph = buildGraph('de', page)
    const enFaq = findNode(enGraph, 'FAQPage')
    const deFaq = findNode(deGraph, 'FAQPage')
    const enTexts = enFaq.mainEntity.map((q) => q.name + q.acceptedAnswer.text)
    const deTexts = deFaq.mainEntity.map((q) => q.name + q.acceptedAnswer.text)
    deTexts.forEach((text, i) => {
      expect(text).not.toBe(enTexts[i])
    })
  })
})
