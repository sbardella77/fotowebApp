import { legacyUrls } from '@/lib/seo/legacy-urls'

// Temporary migration sitemap: the legacy unprefixed marketing URLs
// (/pricing, /wedding-photo-sharing, …) that 308 to /en/… since Oct 2026.
// Google indexed several of them before the 308 existed and still picks them
// as canonical over /en/… ("Duplicate, Google chose different canonical than
// user"). Listing them here makes Google recrawl them, see the 308 and move
// the signals to /en/…. The main sitemap stays redirect-free on purpose.
//
// A redirect alone is not enough: Google only sees a 308 when it recrawls the
// old URL, and nothing links to these URLs any more, so a URL Google still
// treats as canonical may wait weeks for that recrawl.
//
// Remove this route (and its robots.txt entry) once URL Inspection reports
// every URL below as "Page with redirect" (or not indexed) and
// /en/wedding-photo-sharing as its own Google-selected canonical.
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
