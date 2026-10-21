import { describe, it, expect } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { getOwnerAnalyticsId } from '@/lib/analytics/identity'

// PostHog Identity Privacy Hardening V1 — the Owner analytics identity
// contract is owner:<Owner.id>, never email. This module is intentionally
// pure (no browser/server/PostHog dependency) so it can be imported
// identically from client bundles (app/dashboard/page.js,
// app/dashboard/login/page-client.js) and server code (route.js, Stripe
// routes, extra-free-event-fulfillment.js) — see the "single implementation"
// contract test below.

describe('getOwnerAnalyticsId', () => {
  it('valid Owner.id → owner:<id>', () => {
    expect(getOwnerAnalyticsId('abc123')).toBe('owner:abc123')
  })

  it('is deterministic — same input always produces the same output', () => {
    expect(getOwnerAnalyticsId('owner-42')).toBe(getOwnerAnalyticsId('owner-42'))
  })

  it('trims surrounding whitespace', () => {
    expect(getOwnerAnalyticsId('  abc123  ')).toBe('owner:abc123')
  })

  it('never derives an identity from an email-shaped string beyond treating it as an opaque id', () => {
    // This function has no concept of "email" — it does not validate,
    // reject, or specially treat email-shaped input. Callers are
    // responsible for passing Owner.id, never email. This test documents
    // that the function itself performs no email detection (by design, it
    // is Owner.id-only at every real call site).
    expect(getOwnerAnalyticsId('owner@example.com')).toBe('owner:owner@example.com')
  })

  it('missing Owner.id (undefined) → null, never fabricated', () => {
    expect(getOwnerAnalyticsId(undefined)).toBeNull()
  })

  it('null Owner.id → null, never fabricated', () => {
    expect(getOwnerAnalyticsId(null)).toBeNull()
  })

  it('empty string → null', () => {
    expect(getOwnerAnalyticsId('')).toBeNull()
  })

  it('whitespace-only string → null', () => {
    expect(getOwnerAnalyticsId('   ')).toBeNull()
  })

  it('non-string types (number, object, array, boolean) → null, never throws', () => {
    expect(getOwnerAnalyticsId(12345)).toBeNull()
    expect(getOwnerAnalyticsId({ id: 'abc123' })).toBeNull()
    expect(getOwnerAnalyticsId(['abc123'])).toBeNull()
    expect(getOwnerAnalyticsId(true)).toBeNull()
  })

  it('never throws on any input', () => {
    for (const input of [undefined, null, '', 0, NaN, {}, [], true, Symbol('x')]) {
      expect(() => getOwnerAnalyticsId(input)).not.toThrow()
    }
  })
})

// Client/server convergence contract (Phase 11): there must be exactly one
// getOwnerAnalyticsId implementation, imported by both sides, so client and
// server always compute a byte-identical distinct_id for the same Owner.
describe('client/server convergence — single implementation, no duplicates', () => {
  const IDENTITY_SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'lib/analytics/identity.js'), 'utf8')

  it('lib/analytics/identity.js exports exactly one getOwnerAnalyticsId function', () => {
    const matches = IDENTITY_SOURCE.match(/export function getOwnerAnalyticsId/g) || []
    expect(matches.length).toBe(1)
  })

  it('no second getOwnerAnalyticsId-like implementation exists elsewhere in the repo', () => {
    // Scoped to the actual source directories where an implementation could
    // plausibly live, instead of the repo root — a whole-tree grep has to
    // walk node_modules (hundreds of MB) before the exclusions below ever
    // apply to it, which measured 2-4s locally and left thin margin against
    // Vitest's default 5000ms test timeout under CI load (CI-GOV-012A).
    // node_modules/.next exclusions are kept as defense-in-depth even though
    // scoping already keeps this out of both.
    const output = execSync(
      `grep -rln "function getOwnerAnalyticsId" --include="*.js" --include="*.jsx" app lib components hooks scripts | grep -v node_modules | grep -v "\\.next"`,
      { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' },
    )
    const files = output.trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, ''))
    expect(files).toEqual(['lib/analytics/identity.js'])
  })

  it('a duplicate getOwnerAnalyticsId-like implementation under a scanned directory would be caught', () => {
    const DUPLICATE_SOURCE = 'export function getOwnerAnalyticsId(x) { return x }\n'
    const tmpDir = resolve(import.meta.dirname, '..', 'lib', '__tmp-identity-duplicate-check__')
    const tmpFile = resolve(tmpDir, 'duplicate.js')
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(tmpFile, DUPLICATE_SOURCE)
    try {
      const output = execSync(
        `grep -rln "function getOwnerAnalyticsId" --include="*.js" --include="*.jsx" app lib components hooks scripts | grep -v node_modules | grep -v "\\.next"`,
        { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' },
      )
      const files = output.trim().split('\n').filter(Boolean).map((f) => f.replace(/^\.\//, ''))
      expect(files).toContain('lib/__tmp-identity-duplicate-check__/duplicate.js')
      expect(files.length).toBeGreaterThan(1)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  const CLIENT_FILES = [
    'app/dashboard/page.js',
    'app/dashboard/login/page-client.js',
  ]
  const SERVER_FILES = [
    'app/api/[[...path]]/route.js',
    'app/api/stripe/webhook/route.js',
    'app/api/stripe/checkout-session/route.js',
    'app/api/stripe/unlock-download/route.js',
    'lib/server/extra-free-event-fulfillment.js',
  ]

  it.each([...CLIENT_FILES, ...SERVER_FILES])('%s imports getOwnerAnalyticsId from lib/analytics/identity', (file) => {
    const source = readFileSync(resolve(import.meta.dirname, '..', file), 'utf8')
    expect(source).toContain("from '@/lib/analytics/identity'")
    expect(source).toContain('getOwnerAnalyticsId')
  })

  it('client and server produce byte-identical output for the same Owner.id', () => {
    const ownerId = 'shared-owner-id-42'
    // Both "sides" literally call the same imported function — this
    // assertion is the contract itself: there is no second code path that
    // could compute a different distinct_id for the same Owner.
    const clientResult = getOwnerAnalyticsId(ownerId)
    const serverResult = getOwnerAnalyticsId(ownerId)
    expect(clientResult).toBe('owner:shared-owner-id-42')
    expect(clientResult).toBe(serverResult)
  })
})
