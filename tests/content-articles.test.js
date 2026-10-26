import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import sitemap from '@/app/sitemap'
import { LOCALES } from '@/lib/i18n/config'
import { ARTICLES, ARTICLE_SECTION_LABEL, getArticle, getArticlesForLocale } from '@/lib/content/articles'
import { getArticleNode } from '@/lib/structured-data/article'
import { buildLlmsTxt } from '@/lib/seo/llms-txt'

describe('editorial articles', () => {
  it('have unique locale+slug pairs in a supported locale', () => {
    const keys = ARTICLES.map((a) => `${a.locale}/${a.slug}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const a of ARTICLES) {
      expect(LOCALES).toContain(a.locale)
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it.each(ARTICLES.map((a) => [a.slug, a]))('%s has the fields the page, schema and footer need', (_slug, a) => {
    for (const field of ['title', 'description', 'h1', 'eyebrow', 'navLabel', 'published', 'updated']) {
      expect(a[field], field).toBeTruthy()
    }
    expect(a.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(a.updated >= a.published).toBe(true)
    expect(a.description.length).toBeLessThanOrEqual(170)
    expect(a.intro.length).toBeGreaterThan(0)
    expect(a.sections.length).toBeGreaterThan(0)
    expect(a.cta.title).toBeTruthy()
    for (const slug of a.related || []) expect(getArticle(a.locale, slug), slug).not.toBeNull()
    for (const s of a.sections) {
      if (s.table) for (const row of s.table.rows) expect(row).toHaveLength(s.table.head.length)
    }
    expect(ARTICLE_SECTION_LABEL[a.locale]).toBeTruthy()
  })

  it('comparisons about other products cite sources and a check date', () => {
    for (const a of ARTICLES.filter((x) => x.kind === 'comparison')) {
      expect(a.sources?.length).toBeGreaterThan(0)
      expect(a.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(a.disclaimer).toBeTruthy()
    }
  })

  it('SnapRooms prices quoted in the guides match the pricing page', () => {
    const text = JSON.stringify(ARTICLES)
    for (const m of text.matchAll(/(Pro Event|Wedding Pro)[^0-9]{0,12}(\d+) €/g)) {
      expect({ 'Pro Event': '29', 'Wedding Pro': '49' }[m[1]]).toBe(m[2])
    }
  })

  it('resolves each article only in its own locale', () => {
    expect(getArticle('en', 'alternativa-wedshoots')).toBeNull()
    expect(getArticlesForLocale('en')).toEqual([])
  })

  it('is listed in the sitemap with its real edit date', () => {
    const entries = sitemap()
    for (const a of ARTICLES) {
      const entry = entries.find((e) => e.url === `https://snaprooms.app/${a.locale}/${a.slug}`)
      expect(entry).toBeTruthy()
      expect(entry.lastModified.toISOString().slice(0, 10)).toBe(a.updated)
    }
  })

  it('is listed in llms.txt', () => {
    const text = buildLlmsTxt()
    for (const a of ARTICLES) expect(text).toContain(`https://snaprooms.app/${a.locale}/${a.slug})`)
  })

  it('emits an Article node tied to the page', () => {
    const a = ARTICLES[0]
    const node = getArticleNode({ article: a })
    expect(node['@type']).toBe('Article')
    expect(node.headline).toBe(a.h1)
    expect(node.mainEntityOfPage['@id']).toBe(`https://snaprooms.app/${a.locale}/${a.slug}#webpage`)
    expect(node.dateModified).toBe(a.updated)
  })

  it('locale-prefixed article URLs pass through middleware without a redirect', () => {
    const a = ARTICLES[0]
    const response = middleware(new NextRequest(new URL(`/${a.locale}/${a.slug}`, 'https://snaprooms.app')))
    expect([307, 308]).not.toContain(response.status)
  })
})
