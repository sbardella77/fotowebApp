import { LOCALIZED_PUBLIC_PATHS } from '@/lib/i18n/config'

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://snaprooms.app'

/** Legacy unprefixed marketing URLs that 308 to /en/… (see app/sitemap-legacy.xml/route.js). */
export function legacyUrls() {
  return LOCALIZED_PUBLIC_PATHS.filter((path) => path !== '/').map((path) => `${baseUrl}${path}`)
}
