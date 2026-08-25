import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

const ROOT = resolve(import.meta.dirname, '..')

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const TARGET_FILES = {
  landing: 'components/landing-page.jsx',
  wedding: 'components/wedding-landing-page.jsx',
  photographers: 'components/photographers-landing-page.jsx',
  planners: 'components/planners-landing-page.jsx',
}

const REMOVED_LANDING_KEYS = ['quote', 'quoteHighlight', 'quoteAttribution']
const REMOVED_OTHER_KEYS = ['testimonialQuote', 'testimonialAttribution']

const PLACEHOLDER_NAMES = ['Sarah', 'Emily', 'James', 'Maria']

// Legitimate, out-of-scope uses of "Sarah" as a generic example event name in
// form-input placeholders (e.g. "Event name (e.g. Sarah's Wedding)") — unrelated
// to the removed testimonials and must not trip this check.
const EXEMPT_KEYS = new Set(['roomNamePlaceholder', 'finalPlaceholder', 'eventPlaceholder'])

describe('placeholder testimonials are fully removed from markup (SEO P1.2b)', () => {
  it.each(Object.entries(TARGET_FILES))('%s component has no blockquote or aria-label="Testimonial"', (_key, relPath) => {
    const source = readComponent(relPath)
    expect(source).not.toContain('<blockquote')
    expect(source).not.toContain('aria-label="Testimonial"')
    expect(source).not.toContain('{/* Testimonial */}')
  })
})

describe('placeholder testimonial dictionary keys no longer exist (SEO P1.2b)', () => {
  it.each(LOCALES)('%s dictionary has no testimonial keys in landing/wedding/photographers/planners', (locale) => {
    for (const key of REMOVED_LANDING_KEYS) {
      expect(dictionaries[locale].landing).not.toHaveProperty(key)
    }
    for (const ns of ['wedding', 'photographers', 'planners']) {
      for (const key of REMOVED_OTHER_KEYS) {
        expect(dictionaries[locale][ns]).not.toHaveProperty(key)
      }
    }
  })

  it.each(LOCALES)('%s dictionary values in these namespaces never mention the old placeholder names', (locale) => {
    const namespaces = ['landing', 'wedding', 'photographers', 'planners']
    for (const ns of namespaces) {
      for (const [key, value] of Object.entries(dictionaries[locale][ns])) {
        if (typeof value !== 'string') continue
        if (EXEMPT_KEYS.has(key)) continue
        for (const name of PLACEHOLDER_NAMES) {
          const wordBoundaryMatch = new RegExp(`\\b${name}\\b`).test(value)
          expect(
            wordBoundaryMatch,
            `${locale}.${ns}.${key} still references placeholder name "${name}": ${value}`
          ).toBe(false)
        }
      }
    }
  })
})

describe('new callout copy is present for all locales (SEO P1.2b)', () => {
  it.each(LOCALES)('%s has benefitCalloutTitle/Desc, capabilityCalloutTitle/Desc, and useCaseCalloutTitle/Desc (x2)', (locale) => {
    expect(typeof dictionaries[locale].landing.benefitCalloutTitle).toBe('string')
    expect(dictionaries[locale].landing.benefitCalloutTitle.length).toBeGreaterThan(0)
    expect(typeof dictionaries[locale].landing.benefitCalloutDesc).toBe('string')
    expect(dictionaries[locale].landing.benefitCalloutDesc.length).toBeGreaterThan(0)

    expect(typeof dictionaries[locale].wedding.capabilityCalloutTitle).toBe('string')
    expect(dictionaries[locale].wedding.capabilityCalloutTitle.length).toBeGreaterThan(0)
    expect(typeof dictionaries[locale].wedding.capabilityCalloutDesc).toBe('string')
    expect(dictionaries[locale].wedding.capabilityCalloutDesc.length).toBeGreaterThan(0)

    for (const ns of ['photographers', 'planners']) {
      expect(typeof dictionaries[locale][ns].useCaseCalloutTitle).toBe('string')
      expect(dictionaries[locale][ns].useCaseCalloutTitle.length).toBeGreaterThan(0)
      expect(typeof dictionaries[locale][ns].useCaseCalloutDesc).toBe('string')
      expect(dictionaries[locale][ns].useCaseCalloutDesc.length).toBeGreaterThan(0)
    }
  })
})
