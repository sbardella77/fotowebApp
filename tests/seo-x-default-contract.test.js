import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')
const LOCALE_APP_DIR = resolve(ROOT, 'app/[locale]')

/**
 * Every localized marketing page ships its own inlined `alternates` block
 * (no shared metadata helper exists), so these tests read the page source
 * directly rather than executing `generateMetadata` (which needs Next's
 * request-scoped `notFound()`/dictionary machinery to run safely).
 */
function findLocalizedPageFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...findLocalizedPageFiles(full))
    } else if (entry === 'page.js') {
      found.push(full)
    }
  }
  return found
}

const PAGE_FILES = findLocalizedPageFiles(LOCALE_APP_DIR)

function readAlternatesBlock(filePath) {
  const source = readFileSync(filePath, 'utf8')
  const match = source.match(/alternates:\s*{([\s\S]*?)}\s*,?\s*}\s*\n?\s*}/)
  expect(match, `${filePath} must contain an alternates block`).toBeTruthy()
  return { source, block: match[1] }
}

function parseLanguages(block) {
  const languagesMatch = block.match(/languages:\s*{([\s\S]*?)}/)
  expect(languagesMatch, 'alternates block must contain a languages map').toBeTruthy()
  const entries = {}
  const lineRe = /(?:'([\w-]+)'|(\w[\w-]*)):\s*'([^']+)'/g
  let m
  while ((m = lineRe.exec(languagesMatch[1])) !== null) {
    const key = m[1] || m[2]
    entries[key] = m[3]
  }
  return entries
}

describe('every localized marketing page declares alternates.languages (SEO metadata inventory)', () => {
  it('finds exactly 11 localized page types with alternates', () => {
    const withAlternates = PAGE_FILES.filter((f) => readFileSync(f, 'utf8').includes('alternates:'))
    expect(withAlternates.length).toBe(11)
  })
})

describe.each(PAGE_FILES.map((f) => [f.replace(ROOT + '/', ''), f]))(
  'x-default contract: %s',
  (relPath, filePath) => {
    const { block } = readAlternatesBlock(filePath)
    const languages = parseLanguages(block)

    it('declares an x-default entry', () => {
      expect(languages['x-default']).toBeDefined()
    })

    it('x-default points to the English equivalent (matches the en entry)', () => {
      expect(languages['x-default']).toBe(languages.en)
    })

    it('x-default never points to bare "/"', () => {
      expect(languages['x-default']).not.toBe('/')
    })

    it('x-default is prefixed with the default locale segment', () => {
      expect(languages['x-default'].startsWith(`/${DEFAULT_LOCALE}`)).toBe(true)
    })

    it('all existing locale alternates remain present and unchanged', () => {
      for (const locale of LOCALES) {
        expect(languages[locale]).toBeDefined()
        expect(languages[locale].startsWith(`/${locale}`)).toBe(true)
      }
    })

    it('canonical remains self-referencing to `/${locale}` (+ suffix)', () => {
      expect(block).toMatch(/canonical:\s*`\/\$\{locale\}[^`]*`/)
    })

    it('the localized path suffix is identical across every language entry, including x-default', () => {
      const suffixOf = (path, locale) => path.slice(`/${locale}`.length)
      const enSuffix = suffixOf(languages.en, 'en')
      for (const locale of LOCALES) {
        expect(suffixOf(languages[locale], locale)).toBe(enSuffix)
      }
      expect(suffixOf(languages['x-default'], DEFAULT_LOCALE)).toBe(enSuffix)
    })
  }
)

describe('x-default addition does not introduce duplicate hreflang values', () => {
  it.each(PAGE_FILES.map((f) => [f.replace(ROOT + '/', ''), f]))('%s has no duplicate URL across distinct hreflang keys', (_rel, filePath) => {
    const { block } = readAlternatesBlock(filePath)
    const languages = parseLanguages(block)
    const nonDefaultKeys = Object.keys(languages).filter((k) => k !== 'x-default')
    const values = nonDefaultKeys.map((k) => languages[k])
    expect(new Set(values).size).toBe(values.length)
  })
})
