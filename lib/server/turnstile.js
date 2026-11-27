/**
 * Cloudflare Turnstile server-side verification (anti-bot on room creation).
 *
 * Config: TURNSTILE_SECRET_KEY (server) + NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * (client widget). When the secret is unset the check is skipped, so local
 * dev and tests keep working without Cloudflare; production must set both.
 *
 * Failure policy:
 * - missing / invalid / expired / reused token → reject (fail closed)
 * - Cloudflare unreachable or 5xx → allow and log (fail open), so a
 *   Cloudflare outage never blocks every signup. IP rate limits still apply.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5000

export function isTurnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

/**
 * @param {string|undefined|null} token  value from the client widget
 * @param {{ remoteIp?: string, expectedAction?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ success: boolean, skipped?: boolean, failOpen?: boolean, errorCodes?: string[] }>}
 */
export async function verifyTurnstileToken(token, { remoteIp, expectedAction, fetchImpl = fetch } = {}) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { success: true, skipped: true }

  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { success: false, errorCodes: ['missing-input-response'] }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp)

  let data
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error('[turnstile] siteverify HTTP', response.status, '— failing open')
      return { success: true, failOpen: true }
    }
    data = await response.json()
  } catch (error) {
    console.error('[turnstile] siteverify unreachable — failing open:', error?.name || 'error')
    return { success: true, failOpen: true }
  }

  if (!data?.success) {
    return { success: false, errorCodes: Array.isArray(data?.['error-codes']) ? data['error-codes'] : [] }
  }
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { success: false, errorCodes: ['action-mismatch'] }
  }
  return { success: true }
}
