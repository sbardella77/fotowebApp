// Owner dashboard session-expiry detection. Zero React/DOM dependency so it
// stays trivially unit-testable and can't be accidentally wired into
// guest/photographer-token upload flows, which never see this module.
//
// classifyOwnerApiFailure only looks at the HTTP status — never at
// error.message text, since the exact string "Owner authentication
// required" is also reused server-side for an unrelated 403 authorization
// mismatch (see app/api/[[...path]]/route.js deletePrivateDeliveryAsset).
// 401 is otherwise used ONLY by requireOwner/requireOwnerWithCsrf-gated
// endpoints for "no/invalid/expired session" — callers must only invoke
// this classifier at call sites that are genuinely Owner-session-gated
// (never the login/forgot-password endpoints, where 401 means "wrong
// credentials", not "session expired").

export function classifyOwnerApiFailure(status) {
  return status === 401 ? 'SESSION_EXPIRED' : null
}

// Single-flight confirmation gate: multiple concurrent candidate 401s must
// trigger exactly one GET /api/owner/session confirmation and exactly one
// onExpired transition, never a retry storm. checkSession/onExpired are
// passed in at call time (not bound at construction) so each call site can
// hand in fresh closures without the gate itself going stale across renders.
//
// handleCandidate401 resolves to one of three explicit outcomes — session
// EXPIRY (a distinct concept) is only one of them. Every outcome still means
// the candidate 401 was consumed/handled: callers must abort the action that
// produced it in all three cases, they just differ in whether a session
// transition happened:
//   'EXPIRED'         — confirmed invalid; onExpired fired (once per episode).
//   'SESSION_VALID'   — confirmed still valid (stale 401, e.g. it resolved
//                        after a fresh re-login); no transition, no replay.
//   'ALREADY_HANDLED' — a prior candidate in this episode already resolved
//                        to 'EXPIRED'; no new confirmation, no new transition.
export function createOwnerSessionExpiryGate() {
  let pendingConfirmation = null
  let handled = false

  function handleCandidate401(checkSession, onExpired) {
    if (handled) return Promise.resolve('ALREADY_HANDLED')

    if (!pendingConfirmation) {
      pendingConfirmation = (async () => {
        let authenticated
        try {
          authenticated = await checkSession()
        } catch {
          // Fail-safe policy: the original request already proved a 401 on
          // an Owner-gated endpoint. If we can't even confirm the session
          // (network failure, 5xx from the session endpoint itself), treat
          // that original 401 as authoritative rather than risk leaving the
          // user stuck showing stale, now-broken dashboard data.
          authenticated = false
        }

        pendingConfirmation = null

        if (authenticated) {
          // Stale 401: the request that failed was sent under an old
          // session, but the current session (just confirmed) is valid —
          // e.g. it resolved after a fresh re-login. Do not expire, but the
          // caller must still abort — this 401 is real, just outdated.
          return 'SESSION_VALID'
        }

        if (!handled) {
          handled = true
          onExpired()
        }
        return 'EXPIRED'
      })()
    }

    return pendingConfirmation
  }

  function reset() {
    handled = false
    pendingConfirmation = null
  }

  return { handleCandidate401, reset }
}

// Shared query-param name used to carry a one-shot "you were redirected here
// because your session expired" marker across a page navigation (e.g. from
// /dashboard/analytics back to /dashboard). Exported as a constant so the
// producer (analytics) and consumer (the main dashboard) never duplicate the
// literal string. Carries no payload/message — just a boolean marker; the
// actual localized copy is looked up from dashboard.sessionExpired by the
// consumer, never placed in the URL itself.
export const OWNER_SESSION_EXPIRED_QUERY_PARAM = 'sessionExpired'

// Pure helper: removes a single query param from a location-search string
// (e.g. "?sessionExpired=1&createEvent=1") while preserving every other
// param, returning the new search string ("" if nothing remains, otherwise
// prefixed with "?"). No DOM/router dependency — takes and returns plain
// strings so it's usable both from a browser location and in tests.
export function removeQueryParam(search, name) {
  const params = new URLSearchParams(search)
  params.delete(name)
  const query = params.toString()
  return query ? `?${query}` : ''
}
