'use client'

import { useEffect, useState } from 'react'
import { safeReadJson } from './nav-session-helpers'

/**
 * Lightweight hook that checks whether the current visitor is an
 * authenticated SnapRooms owner.
 *
 * Uses the existing `GET /api/owner/session` endpoint and safely falls
 * back to "not authenticated" on network or JSON parse errors.
 */
export function useOwnerSession() {
  const [state, setState] = useState({ loading: true, authenticated: false })

  useEffect(() => {
    let cancelled = false

    fetch('/api/owner/session', { cache: 'no-store' })
      .then(safeReadJson)
      .then((payload) => {
        if (cancelled) return
        setState({ loading: false, authenticated: !!payload?.authenticated })
      })
      .catch((error) => {
        if (cancelled) return
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('[useOwnerSession] failed:', error)
        }
        setState({ loading: false, authenticated: false })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
