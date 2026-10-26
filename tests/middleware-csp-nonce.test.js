import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware, buildCsp } from '@/middleware'

function makeRequest(path) {
  return new NextRequest(new URL(path, 'https://snaprooms.app'))
}

// CSP nonce hardening (web-check.xyz csp-xss finding): script-src 'unsafe-inline'
// was flagged High severity. buildCsp() must produce a nonce-based script-src
// with no 'unsafe-inline', and the middleware must set a fresh nonce per
// request, forwarded to Server Components and echoed into the CSP header.
describe('buildCsp', () => {
  it('script-src carries the given nonce and never unsafe-inline', () => {
    const csp = buildCsp('abc123')
    expect(csp).toContain("script-src 'self' 'nonce-abc123'")
    expect(csp).not.toContain('unsafe-inline\';')
    expect(csp.split(';').find((d) => d.trim().startsWith('script-src'))).not.toContain('unsafe-inline')
  })

  it('style-src keeps unsafe-inline (only script-src is nonce-hardened)', () => {
    const csp = buildCsp('abc123')
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('two calls with different nonces produce different script-src values', () => {
    expect(buildCsp('nonce-a')).not.toBe(buildCsp('nonce-b'))
  })
})

describe('middleware CSP/nonce wiring', () => {
  it.each(['/en/pricing', '/dashboard', '/admin', '/de/for-wedding-photographers'])(
    '%s response carries a Content-Security-Policy header with a nonce',
    (path) => {
      const response = middleware(makeRequest(path))
      const csp = response.headers.get('content-security-policy')
      expect(csp).toMatch(/script-src 'self' 'nonce-[a-f0-9]{32}'/)
    }
  )

  it('the nonce forwarded to the request matches the nonce in the CSP header', () => {
    const response = middleware(makeRequest('/en/pricing'))
    const forwardedNonce = response.headers.get('x-middleware-request-x-nonce')
    const csp = response.headers.get('content-security-policy')
    expect(forwardedNonce).toBeTruthy()
    expect(csp).toContain(`'nonce-${forwardedNonce}'`)
  })

  it('consecutive requests get different nonces', () => {
    const nonce1 = middleware(makeRequest('/en/pricing')).headers.get('x-middleware-request-x-nonce')
    const nonce2 = middleware(makeRequest('/en/pricing')).headers.get('x-middleware-request-x-nonce')
    expect(nonce1).not.toBe(nonce2)
  })

  it('a redirect response (unprefixed public path) carries no CSP header — no body is rendered', () => {
    const response = middleware(makeRequest('/pricing'))
    expect(response.status).toBe(308)
    expect(response.headers.get('content-security-policy')).toBeNull()
  })

  it('a static asset path is skipped entirely — no nonce, no CSP', () => {
    const response = middleware(makeRequest('/favicon.ico'))
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeNull()
  })
})
