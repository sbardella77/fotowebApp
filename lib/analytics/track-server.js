/**
 * Safe server-side product analytics tracking helper.
 *
 * Uses PostHog Node SDK. All calls are fire-and-forget (no await)
 * so that analytics never delay HTTP responses.
 *
 * Environment variables:
 *   NEXT_PUBLIC_POSTHOG_KEY  (PostHog project API key)
 *   NEXT_PUBLIC_POSTHOG_HOST (optional, defaults to app.posthog.com)
 */

import { PostHog } from 'posthog-node'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

let posthogNode = null

function getServerPostHog() {
  if (!POSTHOG_KEY) return null
  if (!posthogNode) {
    posthogNode = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST })
  }
  return posthogNode
}

/**
 * Track a product event on the server.
 *
 * @param {string} eventName — snake_case event name
 * @param {object} [properties] — extra properties
 * @param {object} [options]
 * @param {string} [options.distinctId] — stable non-PII identifier (e.g. `owner:<Owner.id>` via getOwnerAnalyticsId(), a room-scoped id, or a rate-limit key) — never a raw email
 */
export function trackServerEvent(eventName, properties = {}, options = {}) {
  try {
    const ph = getServerPostHog()
    if (!ph) return

    const distinctId = options.distinctId || 'server_anonymous'

    ph.capture({
      distinctId,
      event: eventName,
      properties,
    })
  } catch {
    // Silently ignore tracking errors
  }
}

/**
 * Flush pending analytics events before shutdown.
 * Call this in edge cases (e.g. Vercel function teardown) if needed.
 */
export async function flushServerAnalytics() {
  try {
    if (posthogNode) {
      await posthogNode.shutdown()
    }
  } catch {
    // Ignore
  }
}
