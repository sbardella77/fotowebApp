/**
 * Consent state machine for non-essential (analytics) browser storage.
 *
 * States: 'unknown' | 'accepted' | 'rejected' | 'withdrawn'.
 * 'expired' is never a stored value — an expired or policy-version-
 * mismatched record is always read back as 'unknown' (see
 * parseConsentCookie), so the banner naturally reappears rather than a
 * stale decision silently persisting as some half-valid state.
 *
 * This module is pure and has no DOM/browser dependency — it only ever
 * receives/returns plain strings and numbers. The thin, DOM-touching
 * wrapper (reading/writing the actual cookie) lives in ./cookie.js.
 */

// DPO decision pending (PRIVACY-CONSENT-001A §M/PRIVACY-DPO-003): the
// exact maximum validity window for a stored consent decision before it
// must be re-collected. 13 months (in days) is used here as a
// commonly-cited upper bound in EU guidance, NOT a confirmed legal
// requirement for this specific product — must be confirmed or adjusted
// by the DPO before this is relied on as a compliance control.
export const CONSENT_MAX_AGE_DAYS = 395 // ~13 months — PENDING DPO APPROVAL

export const CONSENT_COOKIE_NAME = 'snaprooms_cookie_consent'

// Bumping this invalidates every previously-stored consent decision
// (they fail the version check in parseConsentCookie and read back as
// 'unknown'), forcing re-consent after a material policy change.
export const CONSENT_POLICY_VERSION = 'v1'

export const CONSENT_STATES = Object.freeze({
  UNKNOWN: 'unknown',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
})

const VALID_STATES = new Set(Object.values(CONSENT_STATES))

/**
 * Serialize a consent decision into the cookie's stored value shape:
 * `<policyVersion>:<state>:<unixSeconds>`. Deliberately not JSON — kept
 * as simple as the existing NEXT_LOCALE cookie's plain-string convention.
 */
export function serializeConsentValue(state, nowMs = Date.now()) {
  if (!VALID_STATES.has(state) || state === CONSENT_STATES.UNKNOWN) {
    throw new Error(`serializeConsentValue: cannot persist state "${state}" — only accepted/rejected/withdrawn are ever written`)
  }
  const nowSeconds = Math.floor(nowMs / 1000)
  return `${CONSENT_POLICY_VERSION}:${state}:${nowSeconds}`
}

/**
 * Parse a raw cookie value into one of the four states.
 *
 * Returns 'unknown' (never throws) for: no cookie, a malformed value, a
 * value from a different policy version, or a value whose timestamp is
 * older than CONSENT_MAX_AGE_DAYS — collapsing "expired" into "unknown"
 * is deliberate (see module doc) so the banner reappears naturally.
 */
export function parseConsentCookie(raw, nowMs = Date.now()) {
  if (typeof raw !== 'string' || !raw) return CONSENT_STATES.UNKNOWN

  const parts = raw.split(':')
  if (parts.length !== 3) return CONSENT_STATES.UNKNOWN

  const [version, state, timestampStr] = parts
  if (version !== CONSENT_POLICY_VERSION) return CONSENT_STATES.UNKNOWN
  if (!VALID_STATES.has(state) || state === CONSENT_STATES.UNKNOWN) return CONSENT_STATES.UNKNOWN

  const timestampSeconds = Number(timestampStr)
  if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) return CONSENT_STATES.UNKNOWN

  const ageMs = nowMs - timestampSeconds * 1000
  const maxAgeMs = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  if (ageMs < 0 || ageMs > maxAgeMs) return CONSENT_STATES.UNKNOWN

  return state
}

/**
 * Whether analytics initialization is currently permitted. This is the
 * single source of truth every analytics entry point must consult —
 * only 'accepted' permits it; 'unknown', 'rejected', and 'withdrawn' all
 * fail closed identically.
 */
export function isAcceptedState(state) {
  return state === CONSENT_STATES.ACCEPTED
}
