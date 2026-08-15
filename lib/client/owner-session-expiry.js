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
export function createOwnerSessionExpiryGate() {
  let pendingConfirmation = null
  let handled = false

  function handleCandidate401(checkSession, onExpired) {
    if (handled) return Promise.resolve(true)

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
          // e.g. it resolved after a fresh re-login. Do not expire.
          return false
        }

        if (!handled) {
          handled = true
          onExpired()
        }
        return true
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
