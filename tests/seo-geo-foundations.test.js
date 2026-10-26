import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import sitemap from '@/app/sitemap'
import { ARTICLES } from '@/lib/content/articles'
import { LOCALES, LOCALIZED_PUBLIC_PATHS } from '@/lib/i18n/config'
import { getDictionary } from '@/lib/i18n/utils'
import { withSocialMetadata, OG_LOCALE } from '@/lib/seo/social-metadata'
import { buildLlmsTxt } from '@/lib/seo/llms-txt'
import { getMarketingPageGraph } from '@/lib/structured-data/page-graph'
import { PLAN_OFFERS, getSoftwareApplicationNode } from '@/lib/structured-data/software-application'

function request(path, headers = {}) {
  return new NextRequest(new URL(path, 'https://snaprooms.app'), { headers })
}

describe('unprefixed marketing URLs', () => {
  const deepPaths = LOCALIZED_PUBLIC_PATHS.filter((p) => p !== '/')

  it.each(deepPaths)('%s moves permanently (308) to the x-default /en path', (path) => {
    const response = middleware(request(path, { 'accept-language': 'it-IT', 'x-vercel-ip-country': 'IT' }))
    expect(response.status).toBe(308)
    expect(new URL(response.headers.get('location')).pathname).toBe(`/en${path}`)
  })

  it('keeps the query string on the permanent redirect', () => {
    const response = middleware(request('/pricing?plan=wedding-pro'))
    expect(response.status).toBe(308)
    const location = new URL(response.headers.get('location'))
    expect(location.pathname).toBe('/en/pricing')
    expect(location.searchParams.get('plan')).toBe('wedding-pro')
  })

  it('the bare root still negotiates the visitor language with a temporary redirect', () => {
    const response = middleware(request('/', { 'accept-language': 'it-IT' }))
    expect(response.status).toBe(307)
    expect(new URL(response.headers.get('location')).pathname).toBe('/it')
  })
})

describe('withSocialMetadata', () => {
  const base = {
    title: 'Pricing — SnapRooms',
    description: 'Simple pricing.',
    alternates: { canonical: '/it/pricing', languages: { en: '/en/pricing' } },
  }

  it('keeps the page metadata and derives og/twitter tags from it', () => {
    const meta = withSocialMetadata('it', base)
    expect(meta.title).toBe(base.title)
    expect(meta.alternates).toEqual(base.alternates)
    expect(meta.openGraph).toMatchObject({
      type: 'website',
      siteName: 'SnapRooms',
      title: base.title,
      description: base.description,
      url: '/it/pricing',
      locale: 'it_IT',
    })
    expect(meta.openGraph.alternateLocale).toHaveLength(LOCALES.length - 1)
    expect(meta.openGraph.alternateLocale).not.toContain('it_IT')
    const images = [{ url: '/it/opengraph-image', width: 1200, height: 630, alt: 'SnapRooms' }]
    expect(meta.openGraph.images).toEqual(images)
    expect(meta.twitter).toEqual({ card: 'summary_large_image', title: base.title, description: base.description, images })
  })

  it('has an Open Graph locale for every supported locale', () => {
    for (const locale of LOCALES) expect(OG_LOCALE[locale]).toMatch(/^[a-z]{2}_[A-Z]{2}$/)
  })
})

describe('SoftwareApplication structured data', () => {
  it.each(LOCALES)('offer prices match the %s pricing page labels', (locale) => {
    const pricing = getDictionary(locale).pricing
    for (const { price, dictKey } of PLAN_OFFERS) {
      expect(pricing[dictKey].replace(/[^\d,.]/g, '').replace(',', '.')).toBe(price)
    }
  })

  it('names every offer and prices it in EUR', () => {
    const node = getSoftwareApplicationNode({ locale: 'de' })
    expect(node['@type']).toBe('SoftwareApplication')
    expect(node.offers).toHaveLength(PLAN_OFFERS.length)
    for (const offer of node.offers) {
      expect(offer.name).toBeTruthy()
      expect(offer.priceCurrency).toBe('EUR')
      expect(offer.url).toBe('https://snaprooms.app/de/pricing')
    }
  })

  it('is only added to the graph when asked', () => {
    const args = { locale: 'en', path: '/', name: 'n', description: 'd' }
    const types = (graph) => graph['@graph'].map((n) => n['@type'])
    expect(types(getMarketingPageGraph(args))).not.toContain('SoftwareApplication')
    expect(types(getMarketingPageGraph({ ...args, includeApp: true }))).toContain('SoftwareApplication')
  })
})

describe('llms.txt', () => {
  const text = buildLlmsTxt()

  it('starts with the llmstxt.org title and summary', () => {
    expect(text.startsWith('# SnapRooms\n\n> ')).toBe(true)
  })

  it('links every public marketing page with an absolute, locale-prefixed URL', () => {
    for (const path of LOCALIZED_PUBLIC_PATHS) {
      const expected = path === '/' ? 'https://snaprooms.app/en)' : `https://snaprooms.app/en${path})`
      expect(text).toContain(expected)
    }
  })

  it('lists every plan price', () => {
    for (const { price } of PLAN_OFFERS) expect(text).toContain(`€${price}`)
  })
})

describe('sitemap', () => {
  it('no longer claims every marketing URL changed at the last deploy', () => {
    const guideUrls = new Set(ARTICLES.map((a) => `https://snaprooms.app/${a.locale}/${a.slug}`))
    for (const entry of sitemap()) {
      if (guideUrls.has(entry.url)) continue
      expect(entry.lastModified).toBeUndefined()
    }
  })
})
