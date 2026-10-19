/**
 * PostHog client-side initialization.
 *
 * Initializes PostHog only in the browser and only when a key is present.
 * Safe to import in any client component.
 */

import posthog from 'posthog-js'
import { sanitizeAnalyticsProperties } from './sanitize-url'

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
      // Explicit, documented data-minimization decisions (GEO-PRIVACY-001/002/003):
      // both were previously left at the SDK's own default rather than a
      // reviewed choice. Session Replay is additionally confirmed disabled
      // at the project level, but this makes that a defended code-level
      // guarantee rather than something that could silently change if the
      // project's dashboard toggle is ever flipped without a matching
      // code review.
      autocapture: false,
      disable_session_recording: true,
      // Strip known sensitive query params (e.g. eventSlug) out of
      // $current_url/$referrer before every event is sent.
      sanitize_properties: (properties) => sanitizeAnalyticsProperties(properties),
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
