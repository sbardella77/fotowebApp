import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { LOCALES } from '@/lib/i18n/config'
import { ARTICLES, getArticleForTopic } from '@/lib/content/articles'

const ROOT = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

// The suite runs without a JSX transform, so the component is checked as a
// source contract; getArticleForTopic carries the behaviour.
describe('in-body links to the guides', () => {
  it('finds the article on a topic only in a locale that has one', () => {
    expect(getArticleForTopic('en', 'guest-photos-guide').slug).toBe('wedding-guest-photos-guide')
    expect(getArticleForTopic('es', 'wedshoots-comparison').slug).toBe('alternativa-wedshoots')
    for (const topic of ['guest-photos-guide', 'wedshoots-comparison']) {
      for (const locale of LOCALES) {
        const expected = ARTICLES.find((a) => a.locale === locale && a.topic === topic) || null
        expect(getArticleForTopic(locale, topic), `${locale} ${topic}`).toBe(expected)
      }
    }
    expect(getArticleForTopic('de', 'guest-photos-guide')).toBeNull()
  })

  it('ArticleLink renders nothing without an article and links within the locale', () => {
    const source = read('components/marketing/article-link.jsx')
    expect(source).toContain('const article = getArticleForTopic(locale, topic)')
    expect(source).toContain('if (!article) return null')
    expect(source).toContain('href={localizedPath(locale, `/${article.slug}`)}')
  })

  it('is placed in the body of the wedding and pricing pages', () => {
    expect(read('components/wedding-landing-page.jsx')).toMatch(/<ArticleLink locale=\{locale\} topic="guest-photos-guide"/)
    expect(read('components/pricing-page.jsx')).toMatch(/<ArticleLink locale=\{locale\} topic="wedshoots-comparison"/)
  })
})
