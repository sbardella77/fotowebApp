import { describe, it, expect } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { GET } from '@/app/sitemap-legacy.xml/route'
import { legacyUrls } from '@/lib/seo/legacy-urls'
import { metadata as uploadMetadata } from '@/app/photographer-upload/layout'
import { LOCALIZED_PUBLIC_PATHS } from '@/lib/i18n/config'

describe('legacy migration sitemap', () => {
  it('lists every unprefixed marketing path except the root', () => {
    const urls = legacyUrls()
    expect(urls).toHaveLength(LOCALIZED_PUBLIC_PATHS.length - 1)
    expect(urls).toContain('https://snaprooms.app/wedding-photo-sharing')
    expect(urls).not.toContain('https://snaprooms.app/')
    for (const url of urls) expect(url).not.toMatch(/snaprooms\.app\/(en|de|it|fr|es|pt-BR)(\/|$)/)
  })

  it('never leaks into the main, redirect-free sitemap', () => {
    const main = new Set(sitemap().map((e) => e.url))
    for (const url of legacyUrls()) expect(main.has(url)).toBe(false)
  })

  it('serves valid sitemap XML', async () => {
    const res = GET()
    expect(res.headers.get('Content-Type')).toMatch(/application\/xml/)
    const xml = await res.text()
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://snaprooms.app/pricing</loc>')
  })
})

describe('robots.txt', () => {
  it('announces both sitemaps and keeps private upload links out of the crawl', () => {
    const r = robots()
    expect(r.sitemap).toEqual(['https://snaprooms.app/sitemap.xml', 'https://snaprooms.app/sitemap-legacy.xml'])
    expect(r.rules.disallow).toContain('/photographer-upload')
  })
})

describe('photographer upload pages', () => {
  it('are noindex', () => {
    expect(uploadMetadata.robots).toEqual({ index: false, follow: false })
  })
})
