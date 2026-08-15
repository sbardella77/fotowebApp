import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const DASHBOARD_PAGE = readSource('app/dashboard/page.js')
const OWNER_SESSION_EXPIRY_MODULE = readSource('lib/client/owner-session-expiry.js')
const ROOM_CLIENT = readSource('components/room-page-client.jsx')
const PHOTOGRAPHER_CLIENT = readSource('components/photographer-upload-page-client.jsx')
const EVENT_MOMENTS_MANAGER = readSource('app/dashboard/components/event-moments-manager.jsx')
const EVENT_COVER_EDITOR = readSource('app/dashboard/components/event-cover-editor.jsx')
const EVENT_DETAIL_PANEL = readSource('app/dashboard/components/event-detail-panel.jsx')
const ANALYTICS_PAGE = readSource('app/dashboard/analytics/page.js')

describe('Fragile string-matching removed from the main dashboard', () => {
  it('1: page.js no longer contains .includes(\'authentication\')', () => {
    expect(DASHBOARD_PAGE).not.toContain(".includes('authentication')")
  })

  it('2: page.js contains no auth detection based on the word "authentication" in a message check', () => {
    expect(DASHBOARD_PAGE).not.toMatch(/error\.message\.includes\(\s*['"]authentication['"]\s*\)/)
  })
})

describe('Session-expiry gate is dependency-free', () => {
  it('3: lib/client/owner-session-expiry.js has zero React import', () => {
    expect(OWNER_SESSION_EXPIRY_MODULE).not.toMatch(/from ['"]react['"]/)
  })

  it('4: lib/client/owner-session-expiry.js has zero fetch/DOM dependency baked in', () => {
    expect(OWNER_SESSION_EXPIRY_MODULE).not.toContain('fetch(')
  })
})

describe('Gate reset after successful login', () => {
  it('5: loginWithPassword resets the session-expiry gate on success', () => {
    const marker = "setAuthState({ loading: false, authenticated: true, email: payload.email })"
    const startIdx = DASHBOARD_PAGE.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(startIdx, startIdx + 400)
    expect(window_).toContain('sessionExpiryGateRef.current.reset()')
  })
})

describe('Guest and photographer-token upload clients are untouched by the Owner session-expiry helper', () => {
  it('6: components/room-page-client.jsx does not import owner-session-expiry', () => {
    expect(ROOM_CLIENT).not.toContain('owner-session-expiry')
  })

  it('7: components/photographer-upload-page-client.jsx does not import owner-session-expiry', () => {
    expect(PHOTOGRAPHER_CLIENT).not.toContain('owner-session-expiry')
  })
})

describe('/api/uploads/chunk is never globally intercepted', () => {
  it('8: the chunk-upload fetch call in page.js has no consumeOwnerSessionFailure check attached to it', () => {
    const marker = "fetch('/api/uploads/chunk'"
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    // Look at a tight window around the call (before and after) — the
    // session-expiry check must not appear here, since this endpoint is
    // shared with unauthenticated guest/photographer-token uploads.
    const window_ = DASHBOARD_PAGE.slice(Math.max(0, idx - 200), idx + 300)
    expect(window_).not.toContain('consumeOwnerSessionFailure')
  })
})

describe('Nested components remain unmodified in this Phase 1 commit', () => {
  it('9: event-moments-manager.jsx does not import owner-session-expiry', () => {
    expect(EVENT_MOMENTS_MANAGER).not.toContain('owner-session-expiry')
  })

  it('10: event-cover-editor.jsx does not import owner-session-expiry', () => {
    expect(EVENT_COVER_EDITOR).not.toContain('owner-session-expiry')
  })

  it('11: event-detail-panel.jsx does not import owner-session-expiry', () => {
    expect(EVENT_DETAIL_PANEL).not.toContain('owner-session-expiry')
  })

  it('12: analytics/page.js does not import owner-session-expiry', () => {
    expect(ANALYTICS_PAGE).not.toContain('owner-session-expiry')
  })
})

describe('createRoom (/api/events) and gallery download (/api/download/gallery) are intentionally excluded', () => {
  it('13: the /api/events call in createRoom has no session-expiry check (server never returns 401 for it)', () => {
    const marker = "fetch('/api/events'"
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(idx, idx + 500)
    expect(window_).not.toContain('consumeOwnerSessionFailure')
  })

  it('14: the gallery-download fetch has no session-expiry check (server never returns 401 for it)', () => {
    const marker = 'fetch(`/api/download/gallery'
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(idx, idx + 500)
    expect(window_).not.toContain('consumeOwnerSessionFailure')
  })
})

describe('logout() is deliberately left untouched (STEP scope: session-expiry UX, not a logout redesign)', () => {
  it('15: logoutOwner call site has no session-expiry check attached', () => {
    const marker = "csrfFetch('/api/owner/logout'"
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(idx, idx + 300)
    expect(window_).not.toContain('consumeOwnerSessionFailure')
  })
})

describe('Covered call-site count', () => {
  it('16: exactly 18 call sites in page.js invoke consumeOwnerSessionFailure', () => {
    const matches = DASHBOARD_PAGE.match(/consumeOwnerSessionFailure\(/g) || []
    // 18 call sites + 0 (the definition itself uses "= async (status) =>",
    // not a call, so it is not counted here).
    expect(matches.length).toBe(18)
  })
})

describe('consumeOwnerSessionFailure returns true for every classified 401 outcome, not only genuine expiry', () => {
  it('17: the definition awaits the gate and unconditionally returns true afterward (stale-but-valid 401s are still consumed)', () => {
    const marker = 'const consumeOwnerSessionFailure = useCallback(async (status) => {'
    const startIdx = DASHBOARD_PAGE.indexOf(marker)
    expect(startIdx).toBeGreaterThan(-1)
    const body = DASHBOARD_PAGE.slice(startIdx, DASHBOARD_PAGE.indexOf('\n  }', startIdx))
    expect(body).toContain("if (classifyOwnerApiFailure(status) !== 'SESSION_EXPIRED') return false")
    expect(body).toContain('await sessionExpiryGateRef.current.handleCandidate401(')
    // The gate's own outcome ('EXPIRED' | 'SESSION_VALID' | 'ALREADY_HANDLED')
    // is deliberately NOT inspected here — every one of those three outcomes
    // means "consumed", so the wrapper always returns true afterward.
    expect(body.trim().endsWith('return true')).toBe(true)
  })
})

describe('Covered call sites structurally abort before the generic raw-error path (stale 401 cannot fall through)', () => {
  const representativeCallSites = [
    { name: 'loadEvents', marker: "fetch('/api/owner/events', { cache: 'no-store' })" },
    { name: 'moderatePhoto', marker: "body: JSON.stringify({ action }),\n      })" },
    { name: 'deleteEvent', marker: "csrfFetch(`/api/owner/events/${selectedSlug}`, { method: 'DELETE' })" },
  ]

  it.each(representativeCallSites)('18: $name — consumeOwnerSessionFailure(...) return precedes the generic throw/setMessage raw-error path', ({ marker }) => {
    const fetchIdx = DASHBOARD_PAGE.indexOf(marker)
    expect(fetchIdx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(fetchIdx, fetchIdx + 400)

    const consumeIdx = window_.indexOf('consumeOwnerSessionFailure(')
    const throwIdx = window_.indexOf('throw new Error(payload.error')

    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    // The consume-check (with its own unconditional `return` on true) must
    // appear before the generic error throw in source order — since the
    // guard always returns when the response was a classified 401
    // (regardless of EXPIRED/SESSION_VALID/ALREADY_HANDLED), the throw is
    // structurally unreachable for any 401, including a stale-but-valid one.
    expect(consumeIdx).toBeLessThan(throwIdx)
    expect(window_.slice(consumeIdx, consumeIdx + 60)).toContain(') return')
  })
})
