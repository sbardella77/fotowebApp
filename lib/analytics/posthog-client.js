/**
 * PostHog client-side initialization.
 *
 * Initializes PostHog only in the browser and only when a key is present.
 * Safe to import in any client component.
 */

import posthog from 'posthog-js'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

let initialized = false

export function initPostHog() {
  if (typeof window === 'undefined') return
  if (initialized) return
  if (!POSTHOG_KEY) return

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Disable automatic pageviews — we track them explicitly for better control
      capture_pageview: false,
      // Respect Do Not Track
      respect_dnt: true,
      // Load flags asynchronously without blocking
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') {
          ph.debug(false)
        }
      },
    })
    initialized = true
  } catch (e) {
    // Silently fail in production so analytics never break the app
    if (process.env.NODE_ENV === 'development') {
      console.warn('[analytics] PostHog init failed:', e)
    }
  }
}

export function getPostHog() {
  if (typeof window === 'undefined') return null
  return posthog
}
