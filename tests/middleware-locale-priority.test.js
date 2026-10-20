import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { LOCALES, LOCALE_COOKIE_NAME } from '@/lib/i18n/config'

function makeRequest({ path = '/', acceptLanguage, country, cookieLocale } = {}) {
  const headers = {}
  if (acceptLanguage) headers['accept-language'] = acceptLanguage
  if (country) headers['x-vercel-ip-country'] = country
  if (cookieLocale) headers['cookie'] = `${LOCALE_COOKIE_NAME}=${cookieLocale}`

  return new NextRequest(new URL(path, 'https://snaprooms.app'), { headers })
}

function redirectedLocale(response) {
  expect(response.status).toBe(307)
  const location = new URL(response.headers.get('location'))
  return location.pathname.split('/')[1]
}

describe('middleware locale detection priority (GEO-TECH-002)', () => {
  it('en-US browser language overrides DE geo-IP', () => {
    const request = makeRequest({ acceptLanguage: 'en-US,en;q=0.9', country: 'DE' })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('en')
  })

  it('de-DE browser language overrides US geo-IP', () => {
    const request = makeRequest({ acceptLanguage: 'de-DE,de;q=0.9', country: 'US' })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('de')
  })

  it('a valid locale cookie wins over both browser language and geo-IP', () => {
    const request = makeRequest({
      cookieLocale: 'it',
      acceptLanguage: 'en-US,en;q=0.9',
      country: 'DE',
    })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('it')
  })

  it('an unsupported browser language falls back to geo-IP', () => {
    const request = makeRequest({ acceptLanguage: 'ja-JP,ja;q=0.9', country: 'DE' })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('de')
  })

  it('missing Accept-Language and unresolvable geo-IP falls back to the default locale', () => {
    const request = makeRequest({})
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('en')
  })

  it('an unsupported browser language and unresolvable geo-IP falls back to the default locale', () => {
    const request = makeRequest({ acceptLanguage: 'ja-JP,ja;q=0.9' })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('en')
  })

  it('honors Accept-Language quality weights, picking the highest-q supported locale', () => {
    const request = makeRequest({ acceptLanguage: 'ja;q=0.9,de;q=0.5,en;q=0.3' })
    const response = middleware(request)
    expect(redirectedLocale(response)).toBe('de')
  })

  it.each(LOCALES)('locale-prefixed URL /%s is left untouched (no redirect)', (locale) => {
    const request = makeRequest({ path: `/${locale}`, acceptLanguage: 'ja-JP', country: 'DE' })
    const response = middleware(request)
    expect(response.status).not.toBe(307)
    expect(response.headers.get('location')).toBeNull()
  })

  it('locale-prefixed URL sets the locale cookie instead of redirecting', () => {
    const request = makeRequest({ path: '/de/pricing' })
    const response = middleware(request)
    expect(response.status).not.toBe(307)
    const cookie = response.cookies.get(LOCALE_COOKIE_NAME)
    expect(cookie?.value).toBe('de')
  })

  it.each(['/dashboard', '/admin', '/event/abc123', '/photographer-upload', '/api/health'])(
    'private route %s is never redirected or locale-prefixed',
    (path) => {
      const request = makeRequest({ path, acceptLanguage: 'de-DE', country: 'DE' })
      const response = middleware(request)
      expect(response.status).not.toBe(307)
      expect(response.headers.get('location')).toBeNull()
    }
  )

  it('dashboard login routing is left untouched regardless of locale signals', () => {
    const request = makeRequest({ path: '/dashboard/login', acceptLanguage: 'de-DE', country: 'US' })
    const response = middleware(request)
    expect(response.status).not.toBe(307)
    expect(response.headers.get('location')).toBeNull()
  })
})
