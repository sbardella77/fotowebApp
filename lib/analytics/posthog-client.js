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
      // $current_url/$referrer/$initial_referrer before every event is
      // sent, and out of posthog-js's own internal $set_once first-touch
      // attribution bundle (see sanitize-url.js — confirmed by tracing
      // the installed posthog-js@1.372.3 that both pipelines call this
      // hook).
      //
      // GEO-PRIVACY-003C: this SDK version logs a deprecation warning for
      // `sanitize_properties` in favor of `before_send`, but migrating was
      // deliberately NOT done here. Tracing the installed SDK found only
      // one call site for `before_send` (inside the main capture() event
      // pipeline) and no equivalent dedicated call site guarding the
      // $set_once attribution-properties computation the way
      // `sanitize_properties` has — so `before_send` cannot be shown to
      // cover the $set_once bundle without deeper, riskier re-engineering
      // this environment has no way to verify behaviorally (no browser
      // available to confirm live). Retaining the working hook and eating
      // the console warning is the safer choice until that can be proven.
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
