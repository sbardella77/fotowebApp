import { NextResponse } from 'next/server'
import {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALIZED_PUBLIC_PATHS,
  PRIVATE_PATH_PREFIXES,
} from '@/lib/i18n/config'

// CSP nonce hardening: script-src previously needed 'unsafe-inline' to allow
// the one inline <script> in app/layout.js (a DataCloneError suppressor).
// Generating a per-request nonce here — and only here, since it must differ
// on every request — lets script-src drop 'unsafe-inline' entirely. The
// static Content-Security-Policy in next.config.js was removed for the same
// reason: a second, static CSP header would still allow 'unsafe-inline' via
// CSP's "multiple policies are ANDed, but 'unsafe-inline' is only ignored
// within a policy that itself defines a nonce/hash" rule.
export function buildCsp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
    "font-src 'self' https://fonts.gstatic.com https://api.fontshare.com",
    "img-src 'self' blob: data: https:",
    "connect-src 'self' https:",
    // Room videos are played straight from Mux's re-encoded MP4 rendition.
    "media-src 'self' blob: https://stream.mux.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

/**
 * SnapRooms locale middleware.
 *
 * - Skips API, static assets, and private app routes.
 * - If the URL already has a valid locale prefix, sets the cookie and continues.
 * - Otherwise detects the best locale and redirects to the locale-prefixed URL.
 * - Every HTML-rendering response carries a fresh CSP nonce, forwarded to
 *   Server Components via the x-nonce request header and echoed back in the
 *   Content-Security-Policy response header.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl

  // Skip static files and Next.js internals — not HTML, no nonce/CSP needed.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icon-') ||
    pathname.startsWith('/apple-icon') ||
    pathname.startsWith('/snaprooms-logo') ||
    pathname.match(/\.(?:jpg|jpeg|png|svg|gif|ico|css|js|woff|woff2|ttf|json|webmanifest)$/)
  ) {
    return NextResponse.next()
  }

  const nonce = crypto.randomUUID().replace(/-/g, '')
  const csp = buildCsp(nonce)
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  function withCsp(response) {
    response.headers.set('Content-Security-Policy', csp)
    return response
  }

  // Skip private / auth / app routes entirely (still HTML — still needs the nonce/CSP).
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // Check if path already starts with a supported locale
  const firstSegment = pathname.split('/')[1]
  const hasLocalePrefix = LOCALES.includes(firstSegment)

  if (hasLocalePrefix) {
    // Persist explicit locale choice in a cookie
    const response = withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
    response.cookies.set(LOCALE_COOKIE_NAME, firstSegment, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    })
    return response
  }

  // Only redirect known public marketing pages; leave unknown paths alone
  // to avoid breaking dynamic links or future routes.
  const isKnownPublicPath = LOCALIZED_PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
  if (!isKnownPublicPath) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // Redirect to locale-prefixed path, preserving query params. No body is
  // rendered, so no nonce/CSP is needed on the redirect response itself.
  const newUrl = request.nextUrl.clone()

  // Deep unprefixed paths (/pricing, /wedding-photo-sharing, …) are legacy
  // URLs from before locale prefixes. A temporary, visitor-dependent 307 led
  // Google to keep them as canonical over /en/… ("Duplicate without
  // user-selected canonical"), so they now move permanently to the
  // x-default locale. Only the bare root still negotiates the visitor's
  // language, and stays temporary because its target varies per visitor.
  if (pathname !== '/') {
    newUrl.pathname = `/${DEFAULT_LOCALE}${pathname}`
    return NextResponse.redirect(newUrl, 308)
  }

  newUrl.pathname = `/${detectLocale(request)}${pathname}`
  return NextResponse.redirect(newUrl)
}

function detectLocale(request) {
  // 1. Cookie preference
  const cookie = request.cookies.get(LOCALE_COOKIE_NAME)
  if (cookie?.value && LOCALES.includes(cookie.value)) {
    return cookie.value
  }

  // 2. Accept-Language header — an explicit, user-authored preference takes
  // priority over geo-IP, which only approximates language from network
  // location and can be wrong for travelers, VPNs, and multilingual countries.
  const acceptLanguage = request.headers.get('accept-language')
  if (acceptLanguage) {
    const languages = acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, q = '1'] = part.trim().split(';q=')
        return {
          code: lang.trim().toLowerCase(),
          q: parseFloat(q),
        }
      })
      .sort((a, b) => b.q - a.q)

    for (const { code } of languages) {
      const match = matchAcceptLanguageCode(code)
      if (match) return match
    }
  }

  // 3. Geo-location (country-based) — fallback when no supported
  // Accept-Language preference is present.
  const countryLocale = detectLocaleFromCountry(request)
  if (countryLocale) {
    return countryLocale
  }

  // 4. Default fallback
  return DEFAULT_LOCALE
}

/**
 * Match a single lowercased Accept-Language tag against LOCALES: exact tag
 * match first (so a region-qualified entry like "pt-BR" can match "pt-br"
 * exactly), then fall back to primary-subtag match (so a bare "pt" or a
 * "pt-PT" request still resolves to our only Portuguese variant instead of
 * falling through to English).
 */
function matchAcceptLanguageCode(code) {
  const exact = LOCALES.find((l) => l.toLowerCase() === code)
  if (exact) return exact

  const primary = code.split('-')[0]
  return LOCALES.find((l) => l.toLowerCase().split('-')[0] === primary) || null
}

function detectLocaleFromCountry(request) {
  const country =
    request.headers.get('x-vercel-ip-country') ||
    request.headers.get('cf-ipcountry') ||
    ''

  const countryToLocale = {
    IT: 'it',
    DE: 'de',
    AT: 'de',
    CH: 'de',
    FR: 'fr',
    ES: 'es',
    US: 'en',
    GB: 'en',
    IE: 'en',
    AU: 'en',
    CA: 'en',
    BR: 'pt-BR',
    PT: 'pt-BR',
  }

  return countryToLocale[country.toUpperCase()] || null
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
