'use client'

import { useEffect } from 'react'
import { initPostHog } from '@/lib/analytics/posthog-client'

/**
 * PostHog initialization wrapper for the Next.js app shell.
 *
 * Place inside the root layout (or wrap pages) so PostHog loads
 * once per client session.
 */
export function AnalyticsProvider({ children }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return children
}
