import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function readSource(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

function extractFunctionBody(source, marker, endMarker = '\n  }') {
  const startIdx = source.indexOf(marker)
  if (startIdx === -1) return ''
  const endIdx = source.indexOf(endMarker, startIdx)
  return endIdx === -1 ? source.slice(startIdx) : source.slice(startIdx, endIdx)
}

const ANALYTICS_PAGE = readSource('app/dashboard/analytics/page.js')

// ─── A. Shared classifier/gate reuse ──────────────────────────────────────────

describe('A. Analytics reuses the shared classifier/gate, no duplicated state machine', () => {
  it('1: imports classifyOwnerApiFailure and createOwnerSessionExpiryGate from the shared module', () => {
    expect(ANALYTICS_PAGE).toMatch(/import \{[\s\S]*?classifyOwnerApiFailure[\s\S]*?createOwnerSessionExpiryGate[\s\S]*?\} from '@\/lib\/client\/owner-session-expiry'/)
  })

  it('2: imports OWNER_SESSION_EXPIRED_QUERY_PARAM from the shared module (no duplicated literal)', () => {
    expect(ANALYTICS_PAGE).toContain('OWNER_SESSION_EXPIRED_QUERY_PARAM')
  })
})

// ─── B. Stable gate instance ───────────────────────────────────────────────────

describe('B. Analytics gate instance is stable across renders and NOT module-level global', () => {
  it('3: createOwnerSessionExpiryGate() is called inside the component via a lazy useRef pattern', () => {
    const marker = 'const sessionExpiryGateRef = useRef(null)'
    const idx = ANALYTICS_PAGE.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window_ = ANALYTICS_PAGE.slice(idx, idx + 200)
    expect(window_).toContain('if (!sessionExpiryGateRef.current) {')
    expect(window_).toContain('sessionExpiryGateRef.current = createOwnerSessionExpiryGate()')
  })

  it('4: the gate constructor call site is inside AnalyticsPage, not at module scope', () => {
    const componentIdx = ANALYTICS_PAGE.indexOf('export default function AnalyticsPage()')
    const gateCallIdx = ANALYTICS_PAGE.indexOf('createOwnerSessionExpiryGate()')
    expect(componentIdx).toBeGreaterThan(-1)
    expect(gateCallIdx).toBeGreaterThan(componentIdx)
  })
})

// ─── C. Overview 401 handling precedes normal failure handling ───────────────

describe('C. Overview request: consume-check precedes normal handling', () => {
  it('5: the overview effect awaits consumeOwnerSessionFailure before reading/setting overview data', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, "const response = await fetch('/api/owner/analytics/overview'", '\n    }\n  }, [auth.ok, consumeOwnerSessionFailure])')
    expect(body).not.toBe('')
    const consumeIdx = body.indexOf('await consumeOwnerSessionFailure(response.status)')
    const setOverviewIdx = body.indexOf('setOverview(d)')
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(setOverviewIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(setOverviewIdx)
  })

  it('6: on a consumed 401 the overview effect returns before calling setOverview at all', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, "const response = await fetch('/api/owner/analytics/overview'", '\n    }\n  }, [auth.ok, consumeOwnerSessionFailure])')
    expect(body).toMatch(/if \(await consumeOwnerSessionFailure\(response\.status\)\) return/)
  })
})

// ─── D. Upsells 401 handling precedes normal failure handling ───────────────

describe('D. Upsells request: consume-check precedes the "Request failed" throw', () => {
  it('7: useAnalyticsData consumes onOwnerSessionFailure before constructing the generic Request-failed error', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, 'function useAnalyticsData(days, enabled, consumeOwnerSessionFailure) {', '\n  return { data, loading, error }')
    expect(body).not.toBe('')
    const consumeIdx = body.indexOf('if (await consumeOwnerSessionFailure(response.status)) return')
    const throwIdx = body.indexOf('throw new Error(`Request failed: ${response.status}`)')
    expect(consumeIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(consumeIdx).toBeLessThan(throwIdx)
  })

  it('8: useAnalyticsData receives consumeOwnerSessionFailure as a parameter (not a shared/global closure)', () => {
    expect(ANALYTICS_PAGE).toContain('function useAnalyticsData(days, enabled, consumeOwnerSessionFailure) {')
    expect(ANALYTICS_PAGE).toContain('useAnalyticsData(days, analyticsEnabled && auth.ok, consumeOwnerSessionFailure)')
  })
})

// ─── Initial-auth race: overview/upsells must never fire before confirmed auth ─

describe('Initial-auth race prevention (STEP 7.7c.2)', () => {
  it('A1: the overview effect early-returns while auth.ok is not yet confirmed true', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, '  useEffect(() => {\n    if (!auth.ok) return', '\n  }, [auth.ok, consumeOwnerSessionFailure])')
    expect(body).not.toBe('')
    expect(body).toContain('if (!auth.ok) return')
  })

  it('A2: the overview effect dependency array includes auth.ok (fires exactly once when it becomes true, never before)', () => {
    expect(ANALYTICS_PAGE).toContain('}, [auth.ok, consumeOwnerSessionFailure])')
  })

  it('A3: the overview guard (!auth.ok) appears before the fetch call, not after — no request can be sent while unconfirmed', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, '  useEffect(() => {\n    if (!auth.ok) return', '\n  }, [auth.ok, consumeOwnerSessionFailure])')
    const guardIdx = body.indexOf('if (!auth.ok) return')
    const fetchIdx = body.indexOf("fetch('/api/owner/analytics/overview'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(fetchIdx)
  })

  it('B1: the upsells hook is enabled only when both analyticsEnabled AND auth.ok are true (explicit, not solely transitive)', () => {
    expect(ANALYTICS_PAGE).toContain('useAnalyticsData(days, analyticsEnabled && auth.ok, consumeOwnerSessionFailure)')
  })

  it('E: the auth.ok gate itself performs no /owner/session fetch — it only reads existing state (no duplicated session call in the gating condition)', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, '  useEffect(() => {\n    if (!auth.ok) return', "fetch('/api/owner/analytics/overview'")
    expect(body).not.toBe('')
    expect(body).not.toContain('/api/owner/session')
  })

  it('F: consumeOwnerSessionFailure (which can trigger the expiry redirect) is never invoked from the initial auth-gate effect itself', () => {
    const initialGateBody = extractFunctionBody(ANALYTICS_PAGE, "fetch('/api/owner/session', { cache: 'no-store' })\n      .then((r) => r.json())", '\n  }, [router])')
    expect(initialGateBody).not.toBe('')
    expect(initialGateBody).not.toContain('consumeOwnerSessionFailure')
    expect(initialGateBody).not.toContain('sessionExpiryGateRef')
  })
})

// ─── E/F. Initial auth gate stays distinct from mid-session expiry ──────────

describe('E. Initial (never-authenticated) access redirects without the sessionExpired marker', () => {
  it('9: the initial session-check effect redirects to a bare /dashboard, no query marker', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, "fetch('/api/owner/session', { cache: 'no-store' })\n      .then((r) => r.json())", '\n  }, [router])')
    expect(body).not.toBe('')
    expect(body).toContain("router.push('/dashboard')")
    expect(body).not.toContain('OWNER_SESSION_EXPIRED_QUERY_PARAM')
    expect(body).not.toContain('sessionExpired')
  })
})

describe('F. Mid-session onExpired redirects WITH the sessionExpired marker, exactly once per episode', () => {
  it('10: handleOwnerSessionExpired uses router.replace with the shared query-param constant', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, 'const handleOwnerSessionExpired = useCallback(() => {', '\n  }, [router])')
    expect(body).toContain('router.replace(`/dashboard?${OWNER_SESSION_EXPIRED_QUERY_PARAM}=1`, { scroll: false })')
  })

  it('11: the initial auth-gate effect and the mid-session expiry handler are distinct functions (never merged)', () => {
    const initialGateIdx = ANALYTICS_PAGE.indexOf("fetch('/api/owner/session', { cache: 'no-store' })\n      .then((r) => r.json())")
    const expiredHandlerIdx = ANALYTICS_PAGE.indexOf('const handleOwnerSessionExpired = useCallback(() => {')
    expect(initialGateIdx).toBeGreaterThan(-1)
    expect(expiredHandlerIdx).toBeGreaterThan(-1)
    expect(initialGateIdx).not.toBe(expiredHandlerIdx)
  })
})

// ─── G. No raw "Request failed: 401" for a consumed Owner 401 ────────────────

describe('G. Analytics can never render a raw "Request failed: 401" for a consumed Owner 401', () => {
  it('12: the consume-check unconditionally returns before the request-failed Error can be constructed for any 401', () => {
    // Structural guarantee: since consumeOwnerSessionFailure returns true for
    // EVERY classified 401 (EXPIRED / SESSION_VALID / ALREADY_HANDLED — see
    // lib/client/owner-session-expiry.js), and test 7 proves the consume
    // check precedes the throw in source order with an unconditional
    // `return`, a 401 can never reach `Request failed: ${response.status}`.
    const body = extractFunctionBody(ANALYTICS_PAGE, 'function useAnalyticsData(days, enabled, consumeOwnerSessionFailure) {', '\n  return { data, loading, error }')
    const consumeLine = body.match(/if \(await consumeOwnerSessionFailure\(response\.status\)\) return/)
    expect(consumeLine).not.toBeNull()
  })
})

// ─── H. No logout / cookie manipulation from Analytics ────────────────────────

describe('H. Analytics never calls POST logout or manipulates the session cookie directly', () => {
  it('13: no /api/owner/logout call anywhere in analytics/page.js', () => {
    expect(ANALYTICS_PAGE).not.toContain('/api/owner/logout')
  })

  it('14: no direct cookie manipulation (document.cookie) in analytics/page.js', () => {
    expect(ANALYTICS_PAGE).not.toContain('document.cookie')
  })

  it('15: no window.location.reload() call in analytics/page.js', () => {
    expect(ANALYTICS_PAGE).not.toContain('window.location.reload')
  })
})

// ─── checkOwnerSessionStillValid does not recurse through the gate ──────────

describe('checkOwnerSessionStillValid is a pure verification primitive (no gate recursion)', () => {
  it('16: checkOwnerSessionStillValid never references consumeOwnerSessionFailure or the gate', () => {
    const body = extractFunctionBody(ANALYTICS_PAGE, 'const checkOwnerSessionStillValid = useCallback(async () => {', '\n  }, [])')
    expect(body).not.toBe('')
    expect(body).not.toContain('consumeOwnerSessionFailure')
    expect(body).not.toContain('sessionExpiryGateRef')
  })
})
