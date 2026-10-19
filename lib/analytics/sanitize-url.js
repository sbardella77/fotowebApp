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
 * PostHog `sanitize_properties` hook: runs on every captured event's
 * property bag before it is sent. Only touches the two URL-shaped
 * properties PostHog attaches by default ($current_url, $referrer) —
 * does not add, rename, or otherwise alter any other property, and never
 * throws (falls back to the original value on any parse failure).
 */
export function sanitizeAnalyticsProperties(properties) {
  if (!properties || typeof properties !== 'object') return properties

  const sanitized = { ...properties }
  if (typeof sanitized.$current_url === 'string') {
    sanitized.$current_url = stripSensitiveParams(sanitized.$current_url)
  }
  if (typeof sanitized.$referrer === 'string') {
    sanitized.$referrer = stripSensitiveParams(sanitized.$referrer)
  }
  return sanitized
}
