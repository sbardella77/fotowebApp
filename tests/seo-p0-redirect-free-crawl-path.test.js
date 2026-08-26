import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import sitemap from '@/app/sitemap'
import { LOCALES, LOCALIZED_PUBLIC_PATHS, localizedPath } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const MARKETING_PATHS = [
  '/',
  '/pricing',
  '/wedding-photo-sharing',
  '/birthday-photo-sharing',
  '/private-party-photo-sharing',
  '/corporate-event-photo-sharing',
  '/for-wedding-photographers',
  '/for-event-planners',
  '/privacy',
  '/terms',
  '/commercial-license',
]

describe('sitemap emits only final, locale-prefixed URLs (SEO P0)', () => {
  const entries = sitemap()

  it('produces exactly LOCALES.length x MARKETING_PATHS.length entries', () => {
    expect(entries.length).toBe(LOCALES.length * MARKETING_PATHS.length)
  })

  it('every entry URL is locale-prefixed and never a bare marketing path', () => {
    for (const entry of entries) {
      const url = new URL(entry.url)
      const firstSegment = url.pathname.split('/')[1]
      expect(LOCALES).toContain(firstSegment)
    }
  })

  it('contains no duplicate URLs', () => {
    const urls = entries.map((e) => e.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('covers every marketing path for every locale', () => {
    for (const locale of LOCALES) {
      for (const path of MARKETING_PATHS) {
        const expected = `https://snaprooms.app${localizedPath(locale, path)}`
        expect(entries.some((e) => e.url === expected)).toBe(true)
      }
    }
  })
})

describe('shared nav/footer use only localizedPath for marketing links (SEO P0)', () => {
  const NAV_SOURCE = readSource('components/marketing/nav.jsx')
  const FOOTER_SOURCE = readSource('components/marketing/footer.jsx')

  it.each([
    ['nav', NAV_SOURCE],
    ['footer', FOOTER_SOURCE],
  ])('%s never contains a bare href to a locale-agnostic marketing path', (_name, source) => {
    for (const path of MARKETING_PATHS) {
      expect(source).not.toContain(`href="${path}"`)
      expect(source).not.toContain(`href='${path}'`)
    }
  })
})

describe('pricing/legal CTAs outside the [locale] tree resolve without a redirect (SEO P0)', () => {
  const TARGETS = {
    'components/room-page-client.jsx': ['/pricing'],
    'app/dashboard/components/insight-card.jsx': ['/pricing'],
    'app/dashboard/components/dashboard-sidebar.jsx': ['/pricing'],
    'app/dashboard/login/page-client.js': ['/privacy'],
  }

  it.each(Object.entries(TARGETS))('%s uses localizedPath(locale, ...) for its marketing link(s)', (relPath, paths) => {
    const source = readSource(relPath)
    expect(source).toContain(`import { localizedPath } from '@/lib/i18n/config'`)
    expect(source).toMatch(/useLocale/)
    for (const path of paths) {
      expect(source).toContain(`localizedPath(locale, '${path}')`)
      expect(source).not.toContain(`href="${path}"`)
      expect(source).not.toContain(`href='${path}'`)
      expect(source).not.toContain(`window.location.href = '${path}'`)
    }
  })
})

describe('legacy locale-agnostic redirect remains available (backward compatibility)', () => {
  it('middleware still treats every marketing path as redirect-eligible for old bookmarks/links', () => {
    for (const path of MARKETING_PATHS) {
      expect(LOCALIZED_PUBLIC_PATHS).toContain(path)
    }
  })

  const MIDDLEWARE_SOURCE = readSource('middleware.js')

  it('middleware.js redirect logic for locale-agnostic public paths is unchanged', () => {
    expect(MIDDLEWARE_SOURCE).toContain('LOCALIZED_PUBLIC_PATHS')
    expect(MIDDLEWARE_SOURCE).toContain('NextResponse.redirect(newUrl)')
  })
})
