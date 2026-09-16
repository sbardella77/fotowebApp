import { describe, it, expect } from 'vitest'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n/config'

// Translation-key completeness guard for the pt-BR addition, plus a
// non-regression "ratchet" over every other locale's PRE-EXISTING gaps.
//
// While building this test we discovered de/it/fr/es already had silent
// dictionary gaps (fr: 25 missing keys, es: 21, it: 2, de: 0) that predate
// this change entirely and are unrelated to adding pt-BR — nothing in the
// codebase enforced key parity before now, so these only ever surfaced as
// silent English fallbacks (via `t.key || 'English text'` call sites) or,
// in two historical cases documented in
// tests/i18n-gallery-download-alerts.test.js, a literal "undefined" alert.
// Fixing that pre-existing debt is out of scope for a "add pt-BR" task, so
// this file: (a) holds pt-BR itself to full, strict parity with en — this
// task IS responsible for that — and (b) puts a ceiling on every other
// locale's known gap count, so a future change can't silently make it
// worse, while a future fix that shrinks or closes a gap just passes with
// room to spare.

function collectLeafPaths(obj, prefix = '', out = new Map()) {
  for (const key of Object.keys(obj)) {
    const value = obj[key]
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectLeafPaths(value, path, out)
    } else {
      out.set(path, value)
    }
  }
  return out
}

const englishPaths = collectLeafPaths(dictionaries[DEFAULT_LOCALE])
const OTHER_LOCALES = LOCALES.filter((l) => l !== DEFAULT_LOCALE)

// Known-at-time-of-writing missing-key counts for locales with pre-existing
// gaps (see comment above) — a ceiling, not a target. de/pt-BR are already
// at 0 and get no slack.
const KNOWN_GAP_CEILING = { de: 0, it: 2, fr: 25, es: 21, 'pt-BR': 0 }

describe('dictionaries.js — locale key parity against en', () => {
  it(`en (${DEFAULT_LOCALE}) has ${englishPaths.size} leaf keys across all namespaces`, () => {
    expect(englishPaths.size).toBeGreaterThan(0)
  })

  it.each(LOCALES)('%s: every top-level namespace present in en exists here', (locale) => {
    const namespaces = Object.keys(dictionaries[DEFAULT_LOCALE])
    for (const ns of namespaces) {
      expect(dictionaries[locale]).toHaveProperty(ns)
    }
  })

  it.each(OTHER_LOCALES)('%s: missing-key count vs en is at or below its known ceiling (no new regressions)', (locale) => {
    const localePaths = collectLeafPaths(dictionaries[locale])
    const missing = [...englishPaths.keys()].filter((path) => !localePaths.has(path))
    const ceiling = KNOWN_GAP_CEILING[locale] ?? 0
    expect(missing.length, `${locale} missing keys: ${JSON.stringify(missing)}`).toBeLessThanOrEqual(ceiling)
  })

  it.each(OTHER_LOCALES)('%s: has no extra keys beyond en', (locale) => {
    const localePaths = collectLeafPaths(dictionaries[locale])
    const extra = [...localePaths.keys()].filter((path) => !englishPaths.has(path))
    expect(extra).toEqual([])
  })

  it.each(LOCALES)('%s: every leaf value is a non-empty string', (locale) => {
    const localePaths = collectLeafPaths(dictionaries[locale])
    for (const [path, value] of localePaths) {
      expect(typeof value, `${locale}.${path} should be a string`).toBe('string')
      expect(value.length, `${locale}.${path} should not be empty`).toBeGreaterThan(0)
    }
  })

  it.each(OTHER_LOCALES)('%s: {placeholder} tokens match en exactly for every key that has them (and exists)', (locale) => {
    const localePaths = collectLeafPaths(dictionaries[locale])
    const tokenPattern = /\{[a-zA-Z0-9_]+\}/g
    for (const [path, enValue] of englishPaths) {
      if (!localePaths.has(path)) continue // pre-existing gap, covered by the ceiling test above
      const enTokens = [...String(enValue).matchAll(tokenPattern)].map((m) => m[0]).sort()
      if (enTokens.length === 0) continue
      const localeValue = localePaths.get(path)
      const localeTokens = [...String(localeValue).matchAll(tokenPattern)].map((m) => m[0]).sort()
      expect(localeTokens, `${locale}.${path} should preserve the same {placeholders} as en`).toEqual(enTokens)
    }
  })
})

describe('pt-BR is registered and fully, strictly complete (this task\'s own responsibility)', () => {
  it('LOCALES includes pt-BR', () => {
    expect(LOCALES).toContain('pt-BR')
  })

  it('dictionaries["pt-BR"] has zero missing keys relative to en', () => {
    const ptBrPaths = collectLeafPaths(dictionaries['pt-BR'])
    const missing = [...englishPaths.keys()].filter((path) => !ptBrPaths.has(path))
    expect(missing).toEqual([])
  })

  it('dictionaries["pt-BR"] has zero extra keys beyond en', () => {
    const ptBrPaths = collectLeafPaths(dictionaries['pt-BR'])
    const extra = [...ptBrPaths.keys()].filter((path) => !englishPaths.has(path))
    expect(extra).toEqual([])
  })

  it('dictionaries.pt-BR has the exact same key count as en', () => {
    const ptBrPaths = collectLeafPaths(dictionaries['pt-BR'])
    expect(ptBrPaths.size).toBe(englishPaths.size)
  })
})
