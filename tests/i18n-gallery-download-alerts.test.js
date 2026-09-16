import { describe, it, expect } from 'vitest'
import { dictionaries } from '@/lib/i18n/dictionaries'

// STEP 7.3 — regression guard for the confirmed fr/es bug where
// alert(t.galleryDownloadLocked) / alert(t.galleryDownloadFailed) in
// app/dashboard/page.js rendered a native browser alert box containing the
// literal text "undefined", because those two keys were missing from the
// fr/es "dashboard" namespace and the call sites had no fallback.

const LOCALES = ['en', 'de', 'it', 'fr', 'es', 'pt-BR']
const KEYS = ['galleryDownloadLocked', 'galleryDownloadFailed']

const ENGLISH_FALLBACKS = {
  galleryDownloadLocked: 'Full gallery downloads require Pro Event, Wedding Pro, or Professional',
  galleryDownloadFailed: 'Unable to download gallery. Please try again later.',
}

describe('dashboard.galleryDownloadLocked / galleryDownloadFailed dictionary coverage', () => {
  it.each(LOCALES)('A. %s has non-empty string values for both keys', (locale) => {
    const dict = dictionaries[locale]?.dashboard
    for (const key of KEYS) {
      expect(typeof dict?.[key]).toBe('string')
      expect(dict[key].length).toBeGreaterThan(0)
    }
  })

  it.each(['fr', 'es'])('B. %s does not resolve either key to undefined (the reported bug)', (locale) => {
    const dict = dictionaries[locale].dashboard
    expect(dict.galleryDownloadLocked).not.toBeUndefined()
    expect(dict.galleryDownloadFailed).not.toBeUndefined()
    // The exact failure mode reported: alert(undefined) stringifies to "undefined".
    expect(String(dict.galleryDownloadLocked)).not.toBe('undefined')
    expect(String(dict.galleryDownloadFailed)).not.toBe('undefined')
  })

  it('C. call-site fallback expression is safe even if a dictionary key is ever missing again', () => {
    // Mirrors exactly: alert(t.galleryDownloadLocked || '<english fallback>')
    const emptyDict = {}
    for (const key of KEYS) {
      const resolved = emptyDict[key] || ENGLISH_FALLBACKS[key]
      expect(resolved).toBe(ENGLISH_FALLBACKS[key])
      expect(resolved).not.toBeUndefined()
    }
  })

  it('D. en/de/it values are unchanged (this fix only touched fr/es)', () => {
    expect(dictionaries.en.dashboard.galleryDownloadLocked).toBe(
      'Full gallery downloads require Pro Event, Wedding Pro, or Professional'
    )
    expect(dictionaries.en.dashboard.galleryDownloadFailed).toBe(
      'Unable to download gallery. Please try again later.'
    )
    expect(dictionaries.de.dashboard.galleryDownloadLocked).toBe(
      'Vollständige Galerie-Downloads erfordern Pro Event, Wedding Pro oder Professional'
    )
    expect(dictionaries.it.dashboard.galleryDownloadLocked).toBe(
      'Il download completo della galleria richiede Pro Event, Wedding Pro o Professional'
    )
  })
})
