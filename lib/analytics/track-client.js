/**
 * Safe client-side product analytics tracking helper.
 *
 * All calls are fire-and-forget and wrapped in try/catch so that
 * tracking failures never break the UI.
 *
 * Consent gating (PRIVACY-CONSENT-001B) lives entirely in
 * ./posthog-client.js, not here: initPostHog() is a no-op (no SDK
 * import, no network request) unless consent is currently 'accepted',
 * and getPostHog() returns null unless initPostHog() actually completed
 * under that same condition. The `if (!ph) return` pattern below is
 * therefore already a complete consent gate for every function in this
 * file — rejected/unknown/withdrawn visitors never reach `ph.capture()`/
 * `ph.identify()`, and no event is queued or replayed for them later.
 */

import { getPostHog, initPostHog } from './posthog-client'

function getDeviceType() {
  if (typeof window === 'undefined') return 'unknown'
  const width = window.innerWidth
  if (width < 640) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

function getDefaultProperties(extra = {}) {
  return {
    device_type: getDeviceType(),
    ...extra,
  }
}

/**
 * Track a product event on the client.
 *
 * @param {string} eventName — snake_case event name
 * @param {object} [properties] — extra properties (roomSlug, pageType, etc.)
 */
export function trackEvent(eventName, properties = {}) {
  try {
    initPostHog()
    const ph = getPostHog()
    if (!ph) return

    const props = getDefaultProperties(properties)
    ph.capture(eventName, props)
  } catch {
    // Silently ignore tracking errors
  }
}

/**
 * Identify a user (owner) for funnel analysis.
 * Only pass a stable, non-PII identifier — for Owners, use
 * getOwnerAnalyticsId() from lib/analytics/identity.js. Never pass a raw
 * email.
 *
 * @param {string} distinctId
 * @param {object} [properties]
 */
export function identifyUser(distinctId, properties = {}) {
  try {
    initPostHog()
    const ph = getPostHog()
    if (!ph) return
    ph.identify(distinctId, properties)
  } catch {
    // Silently ignore
  }
}

/**
 * Reset the PostHog browser identity.
 *
 * Call this on successful logout so the browser's PostHog anonymous ID is
 * regenerated — otherwise posthog-js keeps the just-logged-out Owner's
 * distinct_id, and any subsequent anonymous activity on the same
 * browser/device (e.g. a different person on a shared device) would stay
 * attributed to that Owner until the next identify() call.
 */
export function resetAnalyticsIdentity() {
  try {
    const ph = getPostHog()
    if (!ph) return
    ph.reset()
  } catch {
    // Silently ignore
  }
}

/**
 * Track a page view manually.
 *
 * @param {string} pageType — e.g. 'landing', 'room', 'dashboard'
 * @param {object} [properties]
 */
export function trackPageView(pageType, properties = {}) {
  trackEvent('$pageview', {
    page_type: pageType,
    ...properties,
  })
}
