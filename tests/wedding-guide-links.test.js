import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getArticlesForLocale } from '@/lib/content/articles'

describe('wedding landing guide links', () => {
  it('renders the locale guides from the wedding page body', () => {
    const source = readFileSync('components/wedding-landing-page.jsx', 'utf8')
    expect(source).toMatch(/import \{ GuideLinks \} from '@\/components\/marketing\/guide-links'/)
    expect(source).toMatch(/<GuideLinks locale=\{locale\} \/>/)
  })

  it('has guides only in the locales that publish them', () => {
    expect(getArticlesForLocale('es').length).toBeGreaterThan(0)
    expect(getArticlesForLocale('it').length).toBeGreaterThan(0)
  })
})
