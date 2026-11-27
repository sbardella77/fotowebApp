import { describe, it, expect } from 'vitest'
import { getMarketingLanguageLinks } from '@/lib/i18n/marketing-language-links'
import { LOCALES, LOCALIZED_PUBLIC_PATHS, localizedPath } from '@/lib/i18n/config'
import { ARTICLES, getArticle } from '@/lib/content/articles'

describe('crawlable marketing language destinations', () => {
  it('preserves all marketing paths across all six locales, including a trailing slash', () => {
    for (const locale of LOCALES) {
      for (const path of LOCALIZED_PUBLIC_PATHS) {
        const source = localizedPath(locale, path)
        const links = getMarketingLanguageLinks(`${source}/`)
        expect(Object.keys(links)).toEqual(LOCALES)
        for (const language of LOCALES) expect(links[language]).toBe(localizedPath(language, path))
      }
    }
  })

  it('resolves translated guide slugs by topic instead of copying the source slug', () => {
    expect(getMarketingLanguageLinks('/en/wedshoots-alternative').it).toBe('/it/alternativa-wedshoots')
    expect(getMarketingLanguageLinks('/es/guia-fotos-invitados-boda').en).toBe('/en/wedding-guest-photos-guide')
    for (const article of ARTICLES) {
      const links = getMarketingLanguageLinks(`/${article.locale}/${article.slug}`)
      for (const [language, href] of Object.entries(links)) {
        const slug = href.split('/').slice(2).join('/')
        if (slug) expect(getArticle(language, slug)?.topic).toBe(article.topic)
        else expect(href).toBe(`/${language}`)
      }
    }
  })

  it('uses the homepage when a market has no translation of a guide', () => {
    expect(getMarketingLanguageLinks('/en/wedshoots-alternative').de).toBe('/de')
  })

  it.each(['/dashboard', '/admin', '/event/qr-slug', '/photographer-upload/token', '/api/test', '/en/unknown', '/en/pricing/unknown', '/en/event/private', '/', null])(
    'leaves app and unknown paths to their existing language behavior: %s', (pathname) => {
      expect(getMarketingLanguageLinks(pathname)).toBeNull()
    },
  )
})
