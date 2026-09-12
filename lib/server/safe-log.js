/**
 * SnapRooms — shared PII/secret redaction primitives for server-side logging.
 *
 * Single source of truth for "what is safe to put in a console.* call or an
 * ops alert." lib/server/ops-alerts.js reuses these instead of keeping a
 * second, independently-drifting copy.
 *
 * Constraints (mirrors blob-upload-token.js's own discipline):
 * - Never throws.
 * - Never spreads or recursively serializes an unknown object (an SDK error
 *   can carry headers, request/response bodies, or raw payloads on
 *   properties this module has never heard of — the only way to guarantee
 *   those never reach a log line is to never read them in the first place).
 */

const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'token',
  'cookie',
  'secret',
  'apikey',
  'authorization',
  'card',
  'cvc',
  'cvv',
  'number',
  'stripe',
  'raw',
  'email',
]

export function isSensitiveKey(key) {
  if (typeof key !== 'string') return true
  const lower = key.toLowerCase()
  return SENSITIVE_KEY_SUBSTRINGS.some((sub) => lower.includes(sub))
}

/**
 * Recursively remove sensitive fields and deeply nested raw objects.
 * Only plain objects are sanitized; arrays of IDs/primitives are kept.
 */
export function sanitizeContext(context, depth = 0) {
  if (depth > 3) return '[max-depth]'
  if (context === null || context === undefined) return null
  if (typeof context !== 'object') return context
  if (Array.isArray(context)) {
    return context.slice(0, 20).map((item) => sanitizeContext(item, depth + 1))
  }

  const sanitized = {}
  for (const [key, value] of Object.entries(context)) {
    if (isSensitiveKey(key)) continue
    sanitized[key] = sanitizeContext(value, depth + 1)
  }
  return sanitized
}

const MAX_MESSAGE_LENGTH = 300

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const URL_PATTERN = /https?:\/\/\S+/g
const AUTH_HEADER_PATTERN = /authorization\s*:\s*\S+/gi
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/gi
// Long, contiguous, dash-free alphanumeric runs: catches raw API keys, JWT
// segments, hex secrets — including the random suffix after a provider's
// "prefix_" convention (sk_live_..., re_..., whsec_...), since underscore
// does not count as a valid boundary here (unlike \b, which treats "_" as
// a word character and would fail to isolate the suffix). Deliberately
// does NOT match UUIDs (dash-delimited) or short id suffixes under 32
// chars, so operationally-useful identifiers that legitimately belong in
// a message (an eventId, a short stripeCustomerId suffix) are not
// blanket-redacted. Intentionally conservative, not a guaranteed
// catch-all — see safe-log.test.js for the exact boundary this is tuned
// against.
const OPAQUE_TOKEN_PATTERN = /(?<![A-Za-z0-9])[A-Za-z0-9]{32,}(?![A-Za-z0-9])/g

/**
 * Scrub free-text (an error/provider message) of anything that looks like
 * an email, a URL (which may carry a signed-URL token in its query string),
 * an Authorization/Bearer value, or a long opaque secret. Never throws;
 * always returns a bounded string.
 */
export function redactMessage(value) {
  try {
    if (value === null || value === undefined) return 'no message'
    let text = typeof value === 'string' ? value : String(value)

    text = text
      .replace(AUTH_HEADER_PATTERN, 'authorization: [REDACTED]')
      .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
      .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
      .replace(URL_PATTERN, '[REDACTED_URL]')
      .replace(OPAQUE_TOKEN_PATTERN, '[REDACTED_TOKEN]')

    if (text.length > MAX_MESSAGE_LENGTH) {
      text = `${text.slice(0, MAX_MESSAGE_LENGTH)}…[truncated]`
    }

    return text
  } catch {
    return 'unserializable message'
  }
}

/**
 * Produce a safe, bounded summary of a provider/SDK error for logging.
 *
 * Deliberately reads ONLY message/name/code/status/statusCode — never
 * spreads or recursively walks the error object — so unknown SDK-specific
 * properties (headers, request/response bodies, raw payloads) can never
 * reach a log line through this function, regardless of what a future
 * provider SDK decides to attach to its error instances.
 *
 * Never throws, and handles non-Error inputs (string, plain object, null,
 * undefined) without special-casing by the caller.
 *
 * @param {string} provider — e.g. 'resend' | 'stripe' | 'blob' | 'db'
 * @param {string} operation — static label, e.g. 'send_password_reset'
 * @param {unknown} error
 * @param {string} [correlationId]
 * @returns {{provider: string, operation: string, errorCode: string, safeMessage: string, correlationId?: string}}
 */
export function serializeProviderError(provider, operation, error, correlationId) {
  let errorCode = 'unknown'
  let rawMessage = null

  try {
    if (error && typeof error === 'object') {
      const code = error.code ?? error.status ?? error.statusCode ?? error.name
      if (typeof code === 'string' || typeof code === 'number') {
        errorCode = String(code)
      }
      if (typeof error.message === 'string') {
        rawMessage = error.message
      }
    } else if (typeof error === 'string') {
      rawMessage = error
    }
  } catch {
    // Fall through to the defaults set above — this function must never throw.
  }

  return {
    provider: typeof provider === 'string' && provider ? provider : 'unknown',
    operation: typeof operation === 'string' && operation ? operation : 'unknown',
    errorCode,
    safeMessage: redactMessage(rawMessage),
    ...(correlationId ? { correlationId: String(correlationId) } : {}),
  }
}

export { SENSITIVE_KEY_SUBSTRINGS }
