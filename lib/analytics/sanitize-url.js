/**
 * Strip known sensitive query parameters from URL-shaped analytics
 * properties before they reach PostHog.
 *
 * `eventSlug` is the one identified case today (GEO-PRIVACY audits): it
 * appears on /pricing?eventSlug=... and would otherwise travel into
 * PostHog's $current_url property, letting an anonymous marketing-page
 * analytics event be joined back to a specific private event/gallery.
 * Listed here as a list (not a single constant) so a future sensitive
 * param can be added without redesigning the sanitizer.
 */
const SENSITIVE_URL_PARAMS = ['eventSlug']

function stripSensitiveParams(urlString) {
  if (typeof urlString !== 'string' || !urlString) return urlString

  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    // Not a parseable absolute URL — leave it untouched rather than guess.
    return urlString
  }

  let changed = false
  for (const param of SENSITIVE_URL_PARAMS) {
    if (parsed.searchParams.has(param)) {
      parsed.searchParams.delete(param)
      changed = true
    }
  }

  return changed ? parsed.toString() : urlString
}

/**
 * URL-shaped properties PostHog can attach that may carry a query string,
 * and therefore need sanitizing. `$initial_referrer` is PostHog's own
 * built-in first-touch attribution property (prefixed "$initial_" onto a
 * stored referrer-info object, see posthog-js's get_initial_props()) — it
 * carries the same full-URL shape and risk as $referrer, and is populated
 * by the SDK itself without any app-level first-touch code existing here.
 *
 * $initial_referring_domain is deliberately NOT in this list: it is
 * documented by posthog-js to hold only a hostname (no path or query
 * string), so there is nothing to strip — including it here would be a
 * no-op at best and risks accidentally mangling a bare hostname if its
 * shape ever changes.
 */
const SANITIZED_URL_PROPERTY_KEYS = ['$current_url', '$referrer', '$initial_referrer']

/**
 * PostHog `sanitize_properties` hook: runs on every captured event's
 * property bag before it is sent, AND on the separate $set_once
 * first-touch-attribution property bag posthog-js computes internally
 * (confirmed by tracing the installed SDK: both call sites invoke this
 * exact function, the second one passing the string "$set_once" as the
 * second argument) — so a single flat-object sanitizer here covers both
 * pipelines without needing to special-case either one.
 *
 * Only touches the URL-shaped keys above — does not add, rename, or
 * otherwise alter any other property (including $initial_referring_domain,
 * see above), and never throws (falls back to the original value on any
 * parse failure).
 */
export function sanitizeAnalyticsProperties(properties) {
  if (!properties || typeof properties !== 'object') return properties

  const sanitized = { ...properties }
  for (const key of SANITIZED_URL_PROPERTY_KEYS) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = stripSensitiveParams(sanitized[key])
    }
  }
  return sanitized
}
