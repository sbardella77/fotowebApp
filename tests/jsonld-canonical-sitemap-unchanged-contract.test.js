import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import sitemap from '@/app/sitemap'
import { LOCALES } from '@/lib/i18n/config'
import { JSONLD_PAGES } from './jsonld-pages.fixture'

const ROOT = resolve(import.meta.dirname, '..')

describe('sitemap is unaffected by the JSON-LD addition', () => {
  it('still produces exactly 66 entries (11 paths x 6 locales)', () => {
    expect(sitemap().length).toBe(66)
    expect(sitemap().length).toBe(JSONLD_PAGES.length * LOCALES.length)
  })
})

describe('every page.js still carries its original generateMetadata alternates block untouched', () => {
  const PAGE_FILE_BY_PATH = {
    '/': 'app/[locale]/page.js',
    '/pricing': 'app/[locale]/pricing/page.js',
    '/wedding-photo-sharing': 'app/[locale]/wedding-photo-sharing/page.js',
    '/birthday-photo-sharing': 'app/[locale]/birthday-photo-sharing/page.js',
    '/private-party-photo-sharing': 'app/[locale]/private-party-photo-sharing/page.js',
    '/corporate-event-photo-sharing': 'app/[locale]/corporate-event-photo-sharing/page.js',
    '/for-wedding-photographers': 'app/[locale]/for-wedding-photographers/page.js',
    '/for-event-planners': 'app/[locale]/for-event-planners/page.js',
    '/privacy': 'app/[locale]/privacy/page.js',
    '/terms': 'app/[locale]/terms/page.js',
    '/commercial-license': 'app/[locale]/commercial-license/page.js',
  }

  it.each(Object.entries(PAGE_FILE_BY_PATH))('%s (%s) still has alternates.canonical and alternates.languages', (_path, relFile) => {
    const source = readFileSync(resolve(ROOT, relFile), 'utf8')
    expect(source).toMatch(/alternates:\s*{/)
    expect(source).toMatch(/canonical:\s*`\/\$\{locale\}/)
    expect(source).toMatch(/languages:\s*{/)
    expect(source).toContain("'x-default':")
  })

  it.each(Object.entries(PAGE_FILE_BY_PATH))('%s (%s) also now imports JsonLd and getMarketingPageGraph', (_path, relFile) => {
    const source = readFileSync(resolve(ROOT, relFile), 'utf8')
    expect(source).toContain("from '@/lib/structured-data/json-ld'")
    expect(source).toContain("from '@/lib/structured-data/page-graph'")
  })
})
