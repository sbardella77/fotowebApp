import { cookies } from 'next/headers'
import { LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_NAME } from './config'
import { dictionaries } from './dictionaries'

/**
 * Validate a locale string against supported locales.
 */
export function isValidLocale(locale) {
  return LOCALES.includes(locale)
}

/**
 * Get the best locale from a request:
 * 1. cookie
 * 2. Accept-Language header
 * 3. default
 */
export function detectLocale(request) {
  // 1. Cookie preference
  const cookie = request.cookies.get(LOCALE_COOKIE_NAME)
  if (cookie?.value && isValidLocale(cookie.value)) {
    return cookie.value
  }

  // 2. Accept-Language header
  const acceptLanguage = request.headers.get('accept-language')
  if (acceptLanguage) {
    const parsed = parseAcceptLanguage(acceptLanguage)
    for (const tag of parsed) {
      const match = matchLocale(tag)
      if (match) return match
    }
  }

  // 3. Default
  return DEFAULT_LOCALE
}

/**
 * Parse Accept-Language header into sorted, full (untruncated) language
 * tags, lowercased — e.g. "pt-BR,pt;q=0.9,en;q=0.8" -> ["pt-br", "pt", "en"].
 *
 * Kept as full tags (not just the primary subtag) so a region-qualified
 * LOCALES entry like "pt-BR" can be matched exactly by matchLocale() below,
 * not just by its primary subtag.
 */
export function parseAcceptLanguage(header) {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [lang, q = '1'] = part.trim().split(';q=')
      return { lang: lang.trim().toLowerCase(), q: parseFloat(q) }
    })
    .sort((a, b) => b.q - a.q)
    .map((item) => item.lang)
}

/**
 * Match a single (lowercased) Accept-Language tag against LOCALES.
 * Tries an exact tag match first (handles both plain codes like "en" and
 * region-qualified codes like "pt-br" matching a LOCALES entry of the same
 * shape), then falls back to matching on the primary subtag only — so a
 * bare "pt" or a "pt-PT" request still resolves to our "pt-BR" locale
 * rather than falling through to English, since it's the only Portuguese
 * variant offered.
 */
export function matchLocale(tag) {
  const exact = LOCALES.find((l) => l.toLowerCase() === tag)
  if (exact) return exact

  const primary = tag.split('-')[0]
  const primaryMatch = LOCALES.find((l) => l.toLowerCase().split('-')[0] === primary)
  return primaryMatch || null
}

/**
 * Get dictionary for a locale with English fallback.
 */
export function getDictionary(locale) {
  return dictionaries[locale] || dictionaries[DEFAULT_LOCALE]
}

/**
 * Server-side locale getter from cookies.
 */
export function getServerLocale() {
  try {
    const cookie = cookies().get(LOCALE_COOKIE_NAME)
    if (cookie?.value && isValidLocale(cookie.value)) {
      return cookie.value
    }
  } catch {
    // cookies() may throw in some contexts; fall back to default
  }
  return DEFAULT_LOCALE
}
