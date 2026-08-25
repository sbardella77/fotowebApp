import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const LANDING_SOURCE = readComponent('components/landing-page.jsx')
const WEDDING_SOURCE = readComponent('components/wedding-landing-page.jsx')

const VERTICAL_PATHS = ['/wedding-photo-sharing', '/for-wedding-photographers', '/for-event-planners']

describe('homepage → vertical internal linking (SEO P1.1)', () => {
  it('links to the wedding, photographers, and planners pages via localizedPath', () => {
    for (const path of VERTICAL_PATHS) {
      expect(LANDING_SOURCE).toContain(`localizedPath(locale, '${path}')`)
    }
  })

  it('never reintroduces a bare (non-localized) marketing href for these paths', () => {
    for (const path of VERTICAL_PATHS) {
      expect(LANDING_SOURCE).not.toContain(`href="${path}"`)
      expect(LANDING_SOURCE).not.toContain(`href='${path}'`)
    }
  })
})

describe('wedding page → photographers/planners internal linking (SEO P1.1)', () => {
  const PRO_PATHS = ['/for-wedding-photographers', '/for-event-planners']

  it('links to the photographers and planners pages via localizedPath', () => {
    for (const path of PRO_PATHS) {
      expect(WEDDING_SOURCE).toContain(`localizedPath(locale, '${path}')`)
    }
  })

  it('never reintroduces a bare (non-localized) marketing href for these paths', () => {
    for (const path of PRO_PATHS) {
      expect(WEDDING_SOURCE).not.toContain(`href="${path}"`)
      expect(WEDDING_SOURCE).not.toContain(`href='${path}'`)
    }
  })
})

describe('audience-segmentation and pro-redirect copy is present for all locales', () => {
  const landingKeys = [
    'audienceLabel',
    'audienceTitle',
    'audienceWeddingQ',
    'audiencePhotographerQ',
    'audiencePlannerQ',
  ]
  const weddingKeys = ['proLabel', 'proTitle', 'proPhotographerQ', 'proPlannerQ']

  it.each(LOCALES)('%s dictionary has all new landing.audience* keys as non-empty strings', (locale) => {
    for (const key of landingKeys) {
      expect(typeof dictionaries[locale].landing[key]).toBe('string')
      expect(dictionaries[locale].landing[key].length).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('%s dictionary has all new wedding.pro* keys as non-empty strings', (locale) => {
    for (const key of weddingKeys) {
      expect(typeof dictionaries[locale].wedding[key]).toBe('string')
      expect(dictionaries[locale].wedding[key].length).toBeGreaterThan(0)
    }
  })
})
