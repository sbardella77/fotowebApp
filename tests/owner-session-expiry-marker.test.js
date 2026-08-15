import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { removeQueryParam, OWNER_SESSION_EXPIRED_QUERY_PARAM } from '@/lib/client/owner-session-expiry'

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

// ─── removeQueryParam — pure behavior tests, no source-contract fragility ────

describe('removeQueryParam — pure, real string behavior', () => {
  it('constant is the expected literal', () => {
    expect(OWNER_SESSION_EXPIRED_QUERY_PARAM).toBe('sessionExpired')
  })

  it('B/C: removes only the target param, empty result when nothing remains', () => {
    expect(removeQueryParam('?sessionExpired=1', 'sessionExpired')).toBe('')
    expect(removeQueryParam('sessionExpired=1', 'sessionExpired')).toBe('')
  })

  it('D: preserves every other query param, in order', () => {
    expect(removeQueryParam('?createEvent=1&sessionExpired=1', 'sessionExpired')).toBe('?createEvent=1')
    expect(removeQueryParam('?sessionExpired=1&createEvent=1', 'sessionExpired')).toBe('?createEvent=1')
    expect(removeQueryParam('?a=1&sessionExpired=1&b=2', 'sessionExpired')).toBe('?a=1&b=2')
  })

  it('no-op when the param is absent — other params untouched', () => {
    expect(removeQueryParam('?createEvent=1&extraEvent=success', 'sessionExpired')).toBe('?createEvent=1&extraEvent=success')
  })

  it('handles an empty search string', () => {
    expect(removeQueryParam('', 'sessionExpired')).toBe('')
  })

  it('does not remove params that merely contain the target name as a substring', () => {
    // Guards against a naive string-replace implementation matching
    // "otherSessionExpiredFlag" or similar.
    expect(removeQueryParam('?otherSessionExpiredFlag=1', 'sessionExpired')).toBe('?otherSessionExpiredFlag=1')
  })
})

// ─── Dashboard marker-consumption effect — source-contract for decision logic ─

const DASHBOARD_PAGE = readSource('app/dashboard/page.js')

function extractEffectBody(source, marker, endMarker) {
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const endIdx = source.indexOf(endMarker, startIdx)
  return endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx)
}

const MARKER_EFFECT = extractEffectBody(
  DASHBOARD_PAGE,
  'useEffect(() => {\n    if (authState.loading) return',
  '}, [authState.loading, authState.authenticated])'
)

describe('Dashboard marker-consumption effect — structural decision logic', () => {
  it('effect body was located', () => {
    expect(MARKER_EFFECT).not.toBe('')
  })

  it('A: waits for authState.loading to resolve before doing anything', () => {
    expect(MARKER_EFFECT).toContain('if (authState.loading) return')
  })

  it('guards on the marker being present before any other work — no-op on normal loads', () => {
    expect(MARKER_EFFECT).toContain(`if (!params.has(OWNER_SESSION_EXPIRED_QUERY_PARAM)) return`)
  })

  it('B: sets the localized sessionExpired message only inside the unauthenticated branch', () => {
    const ifIdx = MARKER_EFFECT.indexOf('if (!authState.authenticated) {')
    expect(ifIdx).toBeGreaterThan(-1)
    const setMessageIdx = MARKER_EFFECT.indexOf('setMessage(t.sessionExpired)')
    expect(setMessageIdx).toBeGreaterThan(ifIdx)
    // and it must be the ONLY setMessage call in this effect (no unconditional one)
    const allSetMessage = MARKER_EFFECT.match(/setMessage\(/g) || []
    expect(allSetMessage.length).toBe(1)
  })

  it('C/D: marker cleanup always runs (outside the auth-conditional) and preserves other params via removeQueryParam', () => {
    const ifIdx = MARKER_EFFECT.indexOf('if (!authState.authenticated) {')
    const closeIdx = MARKER_EFFECT.indexOf('}', ifIdx)
    const cleanupIdx = MARKER_EFFECT.indexOf('removeQueryParam(window.location.search, OWNER_SESSION_EXPIRED_QUERY_PARAM)')
    expect(cleanupIdx).toBeGreaterThan(closeIdx) // after the conditional block, not inside it
  })

  it('E: uses router.replace (not push) so the marker never re-enters browser history', () => {
    expect(MARKER_EFFECT).toContain('router.replace(`/dashboard${nextSearch}`, { scroll: false })')
  })

  it('reads window.location.search directly, consistent with the existing Stripe-return effect pattern (no useSearchParams introduced)', () => {
    expect(MARKER_EFFECT).toContain('new URLSearchParams(window.location.search)')
    expect(DASHBOARD_PAGE).not.toContain('useSearchParams')
  })
})

describe('Dashboard marker effect is a distinct effect from the existing Stripe-return effect', () => {
  it('does not live inside the same useEffect as Stripe/extraEvent/upgrade query handling', () => {
    const stripeEffectIdx = DASHBOARD_PAGE.indexOf("const extraEvent = params.get('extraEvent')")
    const markerEffectIdx = DASHBOARD_PAGE.indexOf('if (!params.has(OWNER_SESSION_EXPIRED_QUERY_PARAM)) return')
    expect(stripeEffectIdx).toBeGreaterThan(-1)
    expect(markerEffectIdx).toBeGreaterThan(-1)
    // The marker effect's own useEffect( opening must appear strictly
    // between the Stripe effect's own closing and the marker check —
    // i.e. they are two separate useEffect calls, not one merged effect.
    const stripeEffectCloseIdx = DASHBOARD_PAGE.indexOf('// eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [])', stripeEffectIdx)
    expect(stripeEffectCloseIdx).toBeGreaterThan(-1)
    expect(stripeEffectCloseIdx).toBeLessThan(markerEffectIdx)
  })
})
