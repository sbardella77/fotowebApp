'use client'

import { useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useOwnerSession } from '@/lib/use-owner-session'
import { useIdleTimer } from '@/lib/hooks/use-idle-timer'
import { csrfFetch } from '@/lib/client/csrf-fetch'

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

// One-shot query-param marker read by the login page to show
// dashboard.sessionExpiredInactivity instead of a plain sign-in form —
// mirrors OWNER_SESSION_EXPIRED_QUERY_PARAM's pattern for the unrelated
// "server already rejected a request as unauthenticated" case.
export const INACTIVITY_LOGOUT_QUERY_PARAM = 'loggedOut'
export const INACTIVITY_LOGOUT_QUERY_VALUE = 'inactivity'

/**
 * Mounted once in the dashboard layout so it covers every owner-authenticated
 * route (main dashboard, analytics, …), not just the main dashboard page.
 * Renders nothing — side-effect only.
 *
 * Deliberately independent of app/dashboard/page.js's own auth/session state
 * machinery (sessionExpiryGateRef etc.): that machinery reacts to the server
 * telling it the session is already gone, where this proactively ends a
 * still-valid session after client-side inactivity. Using its own
 * lightweight useOwnerSession() check keeps the two from having to coordinate.
 */
export function DashboardIdleLogout() {
  // useOwnerSession() only checks once per mount, and this component lives
  // in the dashboard layout — which, under the App Router, stays mounted
  // across navigations within /dashboard/* (e.g. the login → dashboard
  // redirect right after signing in). Keying the actual logic on `pathname`
  // forces a fresh mount, and so a fresh session check, on every route
  // change — otherwise a session that started unauthenticated (anyone
  // loading /dashboard/login) would never notice the user later logged in.
  const pathname = usePathname()
  return <DashboardIdleLogoutInner key={pathname} />
}

function DashboardIdleLogoutInner() {
  const router = useRouter()
  const { authenticated } = useOwnerSession()

  const handleIdle = useCallback(() => {
    // Best-effort: if this fails (e.g. already logged out elsewhere, or a
    // network blip), still redirect — the client-side state is what matters
    // for ending this tab's session; a stale server cookie beyond that is no
    // worse than before this feature existed.
    csrfFetch('/api/owner/logout', { method: 'POST' }).finally(() => {
      router.push(`/dashboard/login?${INACTIVITY_LOGOUT_QUERY_PARAM}=${INACTIVITY_LOGOUT_QUERY_VALUE}`)
    })
  }, [router])

  useIdleTimer({ timeoutMs: IDLE_TIMEOUT_MS, onIdle: handleIdle, enabled: authenticated })

  return null
}
