import { describe, it, expect, afterEach } from 'vitest'
import { resolveErrorBoundaryLocale, getErrorBoundaryCopy } from '@/lib/i18n/error-boundary'

const SUPPORTED_LOCALES = ['en', 'de', 'it', 'fr', 'es']
const KEYS = [
  'globalTitle', 'globalBody',
  'dashboardTitle', 'dashboardBody',
  'eventTitle', 'eventBody',
  'reloadPage', 'backToHome',
]

const originalDocument = globalThis.document
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document
  else globalThis.document = originalDocument
  if (originalNavigatorDescriptor === undefined) delete globalThis.navigator
  else Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
})

function stubDocument(cookie) {
  globalThis.document = { cookie }
}
function stubNavigator(languages) {
  Object.defineProperty(globalThis, 'navigator', { value: { languages }, configurable: true, writable: true })
}

describe('resolveErrorBoundaryLocale', () => {
  it.each(SUPPORTED_LOCALES)('A. valid cookie locale: %s', (locale) => {
    stubDocument(`NEXT_LOCALE=${locale}`)
    stubNavigator(['en-US'])
    expect(resolveErrorBoundaryLocale()).toBe(locale)
  })

  it.each([
    ['de-DE', 'de'],
    ['en-US', 'en'],
    ['it-IT', 'it'],
    ['fr-FR', 'fr'],
    ['es-ES', 'es'],
  ])('B. regional navigator value %s normalizes to %s', (tag, expected) => {
    stubDocument('')
    stubNavigator([tag])
    expect(resolveErrorBoundaryLocale()).toBe(expected)
  })

  it('C. unsupported cookie falls through to supported navigator language', () => {
    stubDocument('NEXT_LOCALE=xx')
    stubNavigator(['it-IT'])
    expect(resolveErrorBoundaryLocale()).toBe('it')
  })

  it('C2. unsupported cookie and unsupported navigator falls through to en', () => {
    stubDocument('NEXT_LOCALE=xx')
    stubNavigator(['xx-XX'])
    expect(resolveErrorBoundaryLocale()).toBe('en')
  })

  it('D. malformed/missing cookie falls back safely', () => {
    stubDocument('some=thing; unrelated=1')
    stubNavigator(['fr-FR'])
    expect(resolveErrorBoundaryLocale()).toBe('fr')
  })

  it('D2. cookie key substring collision is not matched (exact key match)', () => {
    stubDocument('OLD_NEXT_LOCALE=de; other=1')
    stubNavigator(['es-ES'])
    // "OLD_NEXT_LOCALE" must not be mistaken for "NEXT_LOCALE".
    expect(resolveErrorBoundaryLocale()).toBe('es')
  })

  it('D3. cookie with standard "; " separator is parsed correctly', () => {
    stubDocument('foo=1; NEXT_LOCALE=fr')
    stubNavigator(['en-US'])
    expect(resolveErrorBoundaryLocale()).toBe('fr')
  })

  it('D4. cookie with no whitespace after ";" is parsed correctly', () => {
    stubDocument('foo=1;NEXT_LOCALE=fr')
    stubNavigator(['en-US'])
    expect(resolveErrorBoundaryLocale()).toBe('fr')
  })

  it('D5. trailing-suffix cookie key collision is not matched (exact key match)', () => {
    stubDocument('NEXT_LOCALE_BACKUP=fr')
    stubNavigator(['es-ES'])
    // "NEXT_LOCALE_BACKUP" must not be mistaken for "NEXT_LOCALE".
    expect(resolveErrorBoundaryLocale()).toBe('es')
  })

  it('D6. unsupported cookie value falls through to supported navigator, else en', () => {
    stubDocument('NEXT_LOCALE=xx')
    stubNavigator(['it-IT'])
    expect(resolveErrorBoundaryLocale()).toBe('it')

    stubDocument('NEXT_LOCALE=xx')
    stubNavigator(['xx-XX'])
    expect(resolveErrorBoundaryLocale()).toBe('en')
  })

  it('E. document undefined falls back to navigator or en', () => {
    delete globalThis.document
    stubNavigator(['de-DE'])
    expect(resolveErrorBoundaryLocale()).toBe('de')

    stubNavigator(undefined)
    expect(resolveErrorBoundaryLocale()).toBe('en')
  })

  it('F. navigator undefined falls back to cookie or en', () => {
    stubDocument('NEXT_LOCALE=it')
    delete globalThis.navigator
    expect(resolveErrorBoundaryLocale()).toBe('it')

    stubDocument('')
    expect(resolveErrorBoundaryLocale()).toBe('en')
  })

  it('neither document nor navigator defined never throws', () => {
    delete globalThis.document
    delete globalThis.navigator
    expect(() => resolveErrorBoundaryLocale()).not.toThrow()
    expect(resolveErrorBoundaryLocale()).toBe('en')
  })
})

describe('getErrorBoundaryCopy', () => {
  it('G. unknown locale returns a complete English object', () => {
    const copy = getErrorBoundaryCopy('xx')
    const enCopy = getErrorBoundaryCopy('en')
    expect(copy).toEqual(enCopy)
    for (const key of KEYS) {
      expect(typeof copy[key]).toBe('string')
      expect(copy[key].length).toBeGreaterThan(0)
    }
  })

  it.each(SUPPORTED_LOCALES)('H. %s: all 8 keys are non-empty strings', (locale) => {
    const copy = getErrorBoundaryCopy(locale)
    for (const key of KEYS) {
      expect(copy[key]).not.toBeUndefined()
      expect(copy[key]).not.toBeNull()
      expect(typeof copy[key]).toBe('string')
      expect(copy[key].length).toBeGreaterThan(0)
    }
  })

  it('I. dashboard/event/global titles are semantically distinct per locale (not collapsed to one generic value)', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = getErrorBoundaryCopy(locale)
      const titles = new Set([copy.globalTitle, copy.dashboardTitle, copy.eventTitle])
      expect(titles.size).toBe(3)
      const bodies = new Set([copy.globalBody, copy.dashboardBody, copy.eventBody])
      expect(bodies.size).toBe(3)
    }
  })

  it('de copy preserves the original hardcoded German meaning', () => {
    const copy = getErrorBoundaryCopy('de')
    expect(copy.globalTitle).toBe('Ein Fehler ist aufgetreten')
    expect(copy.dashboardTitle).toBe('Dashboard nicht verfügbar')
    expect(copy.eventTitle).toBe('Diese Galerie konnte leider nicht geladen werden.')
    expect(copy.reloadPage).toBe('Seite neu laden')
    expect(copy.backToHome).toBe('Zurück zur Startseite')
  })
})
