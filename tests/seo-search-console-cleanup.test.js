import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
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

function request(path) {
  return new NextRequest(new URL(path, 'https://snaprooms.app'))
}

describe('legacy URLs converge on their /en/… page in a single hop', () => {
  it('/wedding-photo-sharing 308s straight to a final /en/wedding-photo-sharing', () => {
    const first = middleware(request('/wedding-photo-sharing'))
    expect(first.status).toBe(308)
    const target = new URL(first.headers.get('location'))
    expect(target.href).toBe('https://snaprooms.app/en/wedding-photo-sharing')

    const second = middleware(request(target.pathname))
    expect(second.status).not.toBe(307)
    expect(second.status).not.toBe(308)
    expect(second.headers.get('location')).toBeNull()
  })

  it('every URL in the legacy sitemap is one the middleware 308s to its /en/… page', () => {
    for (const url of legacyUrls()) {
      const { pathname } = new URL(url)
      const response = middleware(request(pathname))
      expect(response.status).toBe(308)
      expect(new URL(response.headers.get('location')).pathname).toBe(`/en${pathname}`)
    }
  })

  it('the main sitemap lists the final URL and not the redirecting one', () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls).toContain('https://snaprooms.app/en/wedding-photo-sharing')
    expect(urls).not.toContain('https://snaprooms.app/wedding-photo-sharing')
  })
})

describe('robots.txt', () => {
  it('announces both sitemaps', () => {
    const r = robots()
    expect(r.sitemap).toEqual(['https://snaprooms.app/sitemap.xml', 'https://snaprooms.app/sitemap-legacy.xml'])
  })

  it('lets Google crawl upload links, otherwise it could never read their noindex', () => {
    const { disallow } = robots().rules
    expect(disallow.some((rule) => '/photographer-upload/tok_test_dummy'.startsWith(rule))).toBe(false)
  })

  it('keeps the existing private disallow rules', () => {
    expect(robots().rules.disallow).toEqual(['/dashboard', '/admin', '/event', '/api'])
  })
})

describe('photographer upload pages', () => {
  it('are noindex', () => {
    expect(uploadMetadata.robots).toEqual({ index: false, follow: false })
  })

  it('are still served as-is: no locale redirect for a token link', () => {
    const response = middleware(request('/photographer-upload/tok_test_dummy'))
    expect(response.status).not.toBe(307)
    expect(response.status).not.toBe(308)
    expect(response.headers.get('location')).toBeNull()
  })
})
