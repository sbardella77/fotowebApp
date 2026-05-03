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
    for (const lang of parsed) {
      const exact = LOCALES.find((l) => l === lang)
      if (exact) return exact
      const prefixMatch = LOCALES.find((l) => lang.startsWith(l))
      if (prefixMatch) return prefixMatch
    }
  }

  // 3. Default
  return DEFAULT_LOCALE
}

/**
 * Parse Accept-Language header into sorted language codes.
 */
export function parseAcceptLanguage(header) {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [lang, q = '1'] = part.trim().split(';q=')
      return { lang: lang.trim().split('-')[0].toLowerCase(), q: parseFloat(q) }
    })
    .sort((a, b) => b.q - a.q)
    .map((item) => item.lang)
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
