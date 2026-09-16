import { describe, it, expect } from 'vitest'
import { dictionaries } from '@/lib/i18n/dictionaries'

const LOCALES = ['en', 'de', 'it', 'fr', 'es', 'pt-BR']

describe('dashboard.sessionExpired', () => {
  it.each(LOCALES)('%s: is a non-empty string', (locale) => {
    const value = dictionaries[locale]?.dashboard?.sessionExpired
    expect(value).not.toBeUndefined()
    expect(value).not.toBeNull()
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
  })

  it('en/de/it/fr/es values are all distinct (real translations, not a copy-paste placeholder)', () => {
    const values = LOCALES.map((locale) => dictionaries[locale].dashboard.sessionExpired)
    expect(new Set(values).size).toBe(LOCALES.length)
  })
})
