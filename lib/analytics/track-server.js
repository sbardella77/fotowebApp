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
 * Every call must be explicit about whether distinctId identifies a real
 * Person (an authenticated Owner) or not — there is no default. A call
 * missing distinctId or personProfile is dropped (not sent) rather than
 * silently collapsed into a shared 'server_anonymous' PostHog Person, which
 * would otherwise merge unrelated actors/rooms/requests into one artificial
 * identity. See lib/analytics/identity.js for the Owner contract.
 *
 * @param {string} eventName — snake_case event name
 * @param {object} [properties] — extra properties
 * @param {object} options
 * @param {string} options.distinctId — required. For personProfile:true, a real Person id (owner:<Owner.id> via getOwnerAnalyticsId()) — never email. For personProfile:false, any non-PII technical/room/rate-limit key — PostHog will not turn it into a Person regardless of its value.
 * @param {boolean} options.personProfile — required. true = distinctId identifies a known human (creates/updates a PostHog Person). false = no real person actor exists; the event is captured with `$process_person_profile: false` (PostHog's documented mechanism — https://posthog.com/docs/data/anonymous-vs-identified-events — so it is still queryable but never creates/updates a Person).
 */
export function trackServerEvent(eventName, properties = {}, options = {}) {
  try {
    const ph = getServerPostHog()
    if (!ph) return

    const { distinctId, personProfile } = options

    if (!distinctId) {
      console.error(`[analytics] trackServerEvent("${eventName}") dropped: missing distinctId (no shared fallback identity is used).`)
      return
    }
    if (personProfile !== true && personProfile !== false) {
      console.error(`[analytics] trackServerEvent("${eventName}") dropped: missing explicit personProfile (true|false) option.`)
      return
    }

    const finalProperties = personProfile === false
      ? { ...properties, $process_person_profile: false }
      : properties

    ph.capture({
      distinctId,
      event: eventName,
      properties: finalProperties,
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
