/**
 * I18n configuration for SnapRooms.
 *
 * Supported locales: English, Italian, French, Spanish.
 * Default fallback is always English.
 */

export const LOCALES = ['en', 'it', 'fr', 'es']
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
  it: 'Italiano',
  fr: 'Français',
  es: 'Español',
}
