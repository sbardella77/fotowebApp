import { LOCALIZED_PUBLIC_PATHS } from '@/lib/i18n/config'

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://snaprooms.app'

// Temporary migration sitemap: the legacy unprefixed marketing URLs
// (/pricing, /wedding-photo-sharing, …) that 308 to /en/… since Oct 2026.
// Google indexed several of them before the 308 existed and still picks them
// as canonical over /en/… ("Duplicate, Google chose different canonical than
// user"). Listing them here makes Google recrawl them, see the 308 and move
// the signals to /en/…. The main sitemap stays redirect-free on purpose.
//
// Remove this route (and its robots.txt entry) once Search Console reports
// every URL below as "Page with redirect".
export function legacyUrls() {
  return LOCALIZED_PUBLIC_PATHS.filter((path) => path !== '/').map((path) => `${baseUrl}${path}`)
}

export function GET() {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...legacyUrls().map((url) => `  <url><loc>${url}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
