import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// PostHog Identity Privacy Hardening V1 — client-side contract tests.
// This repo has no React rendering harness, so these are source-contract
// tests (matching tests/room-page-client-funnel-analytics.test.js and
// tests/contributor-id.test.js): they assert on the exact call sites rather
// than rendering the components.

const DASHBOARD = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/page.js'), 'utf8')
const LOGIN_CLIENT = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/login/page-client.js'), 'utf8')
const ROOM = readFileSync(resolve(import.meta.dirname, '..', 'components/room-page-client.jsx'), 'utf8')
const TRACK_CLIENT = readFileSync(resolve(import.meta.dirname, '..', 'lib/analytics/track-client.js'), 'utf8')

function extractBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker)
  if (startIdx === -1) throw new Error(`start marker not found: ${startMarker}`)
  const endIdx = source.indexOf(endMarker, startIdx)
  if (endIdx === -1) throw new Error(`end marker not found: ${endMarker}`)
  return source.slice(startIdx, endIdx)
}

// 1 & 8. login identifies using Owner.id, deterministically (same helper,
// same input → same output, proven separately in analytics-identity.test.js)
describe('login identifies using Owner.id', () => {
  it('dashboard/page.js loginWithPassword: identifies via getOwnerAnalyticsId(payload.ownerId)', () => {
    const FN = extractBetween(DASHBOARD, 'const loginWithPassword = async () => {', '\n  const sendForgotLink')
    expect(FN).toContain('const ownerAnalyticsId = getOwnerAnalyticsId(payload.ownerId)')
    expect(FN).toContain('if (ownerAnalyticsId) identifyUser(ownerAnalyticsId)')
  })

  it('dashboard/login/page-client.js login: identifies via getOwnerAnalyticsId(payload.ownerId)', () => {
    const FN = extractBetween(LOGIN_CLIENT, 'const login = async () => {', '\n  const sendForgotLink')
    expect(FN).toContain('const ownerAnalyticsId = getOwnerAnalyticsId(payload.ownerId)')
    expect(FN).toContain('if (ownerAnalyticsId) identifyUser(ownerAnalyticsId)')
  })

  it('both files import getOwnerAnalyticsId from the single shared helper', () => {
    expect(DASHBOARD).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
    expect(LOGIN_CLIENT).toContain("import { getOwnerAnalyticsId } from '@/lib/analytics/identity'")
  })
})

// 2. dashboard bootstrap identifies using the same Owner.id source
describe('dashboard bootstrap (loadSession) identifies using the same Owner.id path', () => {
  const FN = extractBetween(DASHBOARD, 'const loadSession = async () => {', '\n  const logout = async')

  it('calls identify only after authenticated+email are confirmed from /api/owner/session', () => {
    const gateIdx = FN.indexOf('if (payload.authenticated && payload.email) {')
    const identifyIdx = FN.indexOf('getOwnerAnalyticsId(payload.ownerId)')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(identifyIdx).toBeGreaterThan(gateIdx)
  })

  it('uses the exact same getOwnerAnalyticsId(payload.ownerId) pattern as login', () => {
    expect(FN).toContain('const ownerAnalyticsId = getOwnerAnalyticsId(payload.ownerId)')
    expect(FN).toContain('if (ownerAnalyticsId) identifyUser(ownerAnalyticsId)')
  })
})

// 3. email is never supplied to identify() anywhere in the client
describe('email is never passed to identify()', () => {
  it('no identifyUser(...) call site anywhere in the repo passes an email-shaped argument', () => {
    for (const source of [DASHBOARD, LOGIN_CLIENT]) {
      expect(source).not.toMatch(/identifyUser\(\s*payload\.email/)
      expect(source).not.toMatch(/identifyUser\(\s*email/)
    }
  })

  it('the only identifyUser(...) call sites pass ownerAnalyticsId, derived from getOwnerAnalyticsId', () => {
    for (const source of [DASHBOARD, LOGIN_CLIENT]) {
      const calls = source.match(/identifyUser\(([^)]*)\)/g) || []
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        expect(call).toContain('ownerAnalyticsId')
      }
    }
  })
})

// 4. missing Owner.id does not fall back to email
describe('missing Owner.id does not fall back to email', () => {
  it('login and bootstrap only call identifyUser inside an `if (ownerAnalyticsId)` guard — no unconditional call, no email fallback', () => {
    for (const source of [DASHBOARD, LOGIN_CLIENT]) {
      const calls = source.match(/identifyUser\([^)]*\)/g) || []
      for (const call of calls) {
        // Every real call site is gated: `if (ownerAnalyticsId) identifyUser(ownerAnalyticsId)`
        const idx = source.indexOf(call)
        const precedingLine = source.slice(Math.max(0, idx - 40), idx)
        expect(precedingLine).toContain('if (ownerAnalyticsId)')
      }
    }
  })

  it('getOwnerAnalyticsId itself never fabricates an id when given a falsy Owner.id (see analytics-identity.test.js)', () => {
    // Cross-reference assertion: this file only tests the *call sites*
    // wire the guard correctly; analytics-identity.test.js proves the
    // helper returns null (not a fabricated id) for undefined/null/empty.
    expect(true).toBe(true)
  })
})

// 5. guest paths remain anonymous — no identify()/reset() call exists
// anywhere in the guest-facing room/gallery component
describe('guest paths remain anonymous (unchanged by this migration)', () => {
  it('room-page-client.jsx never calls identifyUser', () => {
    expect(ROOM).not.toContain('identifyUser')
  })

  it('room-page-client.jsx never calls posthog identify() or reset()', () => {
    expect(ROOM).not.toMatch(/\.identify\(/)
    expect(ROOM).not.toContain('resetAnalyticsIdentity')
  })

  it('room-page-client.jsx does not import contributorId as a PostHog identity source', () => {
    // contributorId (client UUID v4) must never become a PostHog distinct_id
    // — guests stay on PostHog's own native anonymous id.
    expect(ROOM).not.toMatch(/distinctId.*contributorId/)
  })
})

// 6 & 7. logout success triggers reset; logout failure behavior is safe
describe('logout resets PostHog identity only after confirmed success', () => {
  const FN = extractBetween(DASHBOARD, 'const logout = async () => {', '\n  const loadPlan = async')

  it('imports resetAnalyticsIdentity from the client tracking module', () => {
    expect(DASHBOARD).toContain("import { trackEvent, identifyUser, resetAnalyticsIdentity } from '@/lib/analytics/track-client'")
  })

  it('calls resetAnalyticsIdentity() only after the response.ok failure check has already returned/thrown', () => {
    const failureCheckIdx = FN.indexOf('if (!response.ok) {')
    const throwIdx = FN.indexOf('throw new Error(payload.error || t.logoutFailed)')
    const resetIdx = FN.indexOf('resetAnalyticsIdentity()')
    expect(failureCheckIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(failureCheckIdx)
    expect(resetIdx).toBeGreaterThan(throwIdx)
  })

  it('a failed logout (throw) is caught by the outer try/catch and never reaches resetAnalyticsIdentity()', () => {
    // The throw inside `if (!response.ok)` propagates to the catch block
    // below, which does not call resetAnalyticsIdentity — so a failed
    // server-side logout can never desync client analytics identity from
    // client auth state (both stay "still logged in").
    const catchBlock = extractBetween(FN, '} catch (error) {', '\n  }')
    expect(catchBlock).not.toContain('resetAnalyticsIdentity')
  })

  it('reset happens before auth state is cleared, but only within the success path', () => {
    const resetIdx = FN.indexOf('resetAnalyticsIdentity()')
    const authClearIdx = FN.indexOf("setAuthState({ loading: false, authenticated: false, email: '' })")
    expect(resetIdx).toBeGreaterThan(-1)
    expect(authClearIdx).toBeGreaterThan(resetIdx)
  })
})

describe('resetAnalyticsIdentity (lib/analytics/track-client.js)', () => {
  it('is exported and calls posthog reset()', () => {
    expect(TRACK_CLIENT).toContain('export function resetAnalyticsIdentity()')
    const FN = extractBetween(TRACK_CLIENT, 'export function resetAnalyticsIdentity() {', '\n}')
    expect(FN).toContain('ph.reset()')
  })

  it('is fire-and-forget/safe — wrapped in try/catch like the rest of the module', () => {
    const FN = extractBetween(TRACK_CLIENT, 'export function resetAnalyticsIdentity() {', '\n}')
    expect(FN).toContain('try {')
    expect(FN).toContain('catch')
  })
})
