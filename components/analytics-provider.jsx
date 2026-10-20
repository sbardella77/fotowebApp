'use client'

import { useEffect } from 'react'
import { initPostHog } from '@/lib/analytics/posthog-client'

/**
 * PostHog initialization wrapper for the Next.js app shell.
 *
 * Place inside the root layout (or wrap pages) so PostHog loads once per
 * client session — but only if consent has already been accepted
 * (PRIVACY-CONSENT-001B). initPostHog() itself re-checks consent and is a
 * complete no-op (no SDK fetched, no network request) otherwise; this
 * component does not duplicate that check, it only triggers it once on
 * mount. This effect runs after hydration completes (React effects never
 * run during SSR), so there is no path by which analytics initializes
 * before the client's actual, current consent cookie can be read.
 *
 * App Router client-side navigations do not remount the root layout, so
 * this effect does not re-fire on every route change — unchanged from
 * before this task, not a new regression.
 */
export function AnalyticsProvider({ children }) {
  useEffect(() => {
    initPostHog()
  }, [])

  return children
}
