const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Normalizes a client-supplied anonymous contributor id.
 *
 * Best-effort, analytics-only — never authoritative for security, billing,
 * or gating. Any input that is not a canonical UUID v4 string is discarded
 * (returns null) rather than rejected, so a malformed/spoofed/missing value
 * can never block an upload. Never throws.
 *
 * @param {unknown} value
 * @returns {string|null} lowercase canonical UUID v4, or null
 */
export function normalizeContributorId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!UUID_V4_REGEX.test(trimmed)) return null
  return trimmed.toLowerCase()
}
