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
  it('8: the chunk-upload fetch call in page.js has no handleCandidate401IfExpired check attached to it', () => {
    const marker = "fetch('/api/uploads/chunk'"
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    // Look at a tight window around the call (before and after) — the
    // session-expiry check must not appear here, since this endpoint is
    // shared with unauthenticated guest/photographer-token uploads.
    const window_ = DASHBOARD_PAGE.slice(Math.max(0, idx - 200), idx + 300)
    expect(window_).not.toContain('handleCandidate401IfExpired')
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
    expect(window_).not.toContain('handleCandidate401IfExpired')
  })

  it('14: the gallery-download fetch has no session-expiry check (server never returns 401 for it)', () => {
    const marker = 'fetch(`/api/download/gallery'
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(idx, idx + 500)
    expect(window_).not.toContain('handleCandidate401IfExpired')
  })
})

describe('logout() is deliberately left untouched (STEP scope: session-expiry UX, not a logout redesign)', () => {
  it('15: logoutOwner call site has no session-expiry check attached', () => {
    const marker = "csrfFetch('/api/owner/logout'"
    const idx = DASHBOARD_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = DASHBOARD_PAGE.slice(idx, idx + 300)
    expect(window_).not.toContain('handleCandidate401IfExpired')
  })
})

describe('Covered call-site count', () => {
  it('16: exactly 18 call sites in page.js invoke handleCandidate401IfExpired', () => {
    const matches = DASHBOARD_PAGE.match(/handleCandidate401IfExpired\(/g) || []
    // 18 call sites + 0 (the definition itself uses "= async (status) =>",
    // not a call, so it is not counted here).
    expect(matches.length).toBe(18)
  })
})
