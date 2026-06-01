import { NextResponse } from 'next/server'
import {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALIZED_PUBLIC_PATHS,
  PRIVATE_PATH_PREFIXES,
} from '@/lib/i18n/config'

/**
 * SnapRooms locale middleware.
 *
 * - Skips API, static assets, and private app routes.
 * - If the URL already has a valid locale prefix, sets the cookie and continues.
 * - Otherwise detects the best locale and redirects to the locale-prefixed URL.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl

  // Skip static files and Next.js internals
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

  // Skip private / auth / app routes entirely
  if (PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next()
  }

  // Check if path already starts with a supported locale
  const firstSegment = pathname.split('/')[1]
  const hasLocalePrefix = LOCALES.includes(firstSegment)

  if (hasLocalePrefix) {
    // Persist explicit locale choice in a cookie
    const response = NextResponse.next()
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
    return NextResponse.next()
  }

  // Detect best locale
  const locale = detectLocale(request)

  // Redirect to locale-prefixed path, preserving query params
  const newUrl = request.nextUrl.clone()
  newUrl.pathname = `/${locale}${pathname}`
  return NextResponse.redirect(newUrl)
}

function detectLocale(request) {
  // 1. Cookie preference
  const cookie = request.cookies.get(LOCALE_COOKIE_NAME)
  if (cookie?.value && LOCALES.includes(cookie.value)) {
    return cookie.value
  }

  // 2. Geo-location (country-based)
  const countryLocale = detectLocaleFromCountry(request)
  if (countryLocale) {
    return countryLocale
  }

  // 3. Accept-Language header
  const acceptLanguage = request.headers.get('accept-language')
  if (acceptLanguage) {
    const languages = acceptLanguage
      .split(',')
      .map((part) => {
        const [lang, q = '1'] = part.trim().split(';q=')
        return {
          code: lang.trim().split('-')[0].toLowerCase(),
          q: parseFloat(q),
        }
      })
      .sort((a, b) => b.q - a.q)

    for (const { code } of languages) {
      const exact = LOCALES.find((l) => l === code)
      if (exact) return exact
    }
  }

  // 4. Default fallback
  return DEFAULT_LOCALE
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
  }

  return countryToLocale[country.toUpperCase()] || null
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
