/**
 * I18n configuration for SnapRooms.
 *
 * Supported locales: English, German, Italian, French, Spanish, Brazilian
 * Portuguese. Default fallback is always English.
 */

export const LOCALES = ['en', 'de', 'it', 'fr', 'es', 'pt-BR']
export const DEFAULT_LOCALE = 'en'
export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE'

/**
 * Public marketing page paths that should be locale-prefixed.
 * These are checked by middleware for autoredirect.
 */
export const LOCALIZED_PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/wedding-photo-sharing',
  '/birthday-photo-sharing',
  '/private-party-photo-sharing',
  '/corporate-event-photo-sharing',
  '/for-wedding-photographers',
  '/for-event-planners',
  '/privacy',
  '/terms',
  '/commercial-license',
]

/**
 * Paths that must never be touched by locale middleware.
 */
export const PRIVATE_PATH_PREFIXES = [
  '/api',
  '/_next',
  '/dashboard',
  '/admin',
  '/event',
  '/photographer-upload',
  '/favicon',
  '/icon-',
  '/apple-icon',
  '/snaprooms-logo',
]

/**
 * Locale display labels.
 */
export const LOCALE_LABELS = {
  en: 'English',
  de: 'Deutsch',
  it: 'Italiano',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
}

/**
 * Build the locale-prefixed URL for a known public marketing path.
 * Every locale (including the default 'en') is always prefixed, matching
 * the canonical/hreflang URLs each page already emits via generateMetadata.
 * Internal links and the sitemap should use this instead of a bare path,
 * so they resolve directly to a 200 instead of round-tripping through the
 * locale-detection redirect in middleware.js.
 */
export function localizedPath(locale, path = '') {
  const safeLocale = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
  if (!path || path === '/') return `/${safeLocale}`
  return `/${safeLocale}${path}`
}
