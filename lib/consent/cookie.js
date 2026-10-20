/**
 * Thin, DOM-touching wrapper around the pure state machine in ./state.js.
 * Every function here is a no-op / returns the safe default when called
 * outside a browser (SSR) — this is what guarantees analytics can never
 * be initialized during server rendering or before hydration: there is
 * no cookie to read until `document` exists, and the default read
 * result is always 'unknown', which is always treated as not-accepted.
 */

import {
  CONSENT_COOKIE_NAME,
  CONSENT_MAX_AGE_DAYS,
  CONSENT_STATES,
  isAcceptedState,
  parseConsentCookie,
  serializeConsentValue,
} from './state'

function readRawCookie(name) {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Current consent state, read fresh from the cookie every call — never
 * cached, so a change made in another tab (or via devtools) is picked up
 * on the next read rather than silently going stale.
 */
export function getStoredConsentState() {
  const raw = readRawCookie(CONSENT_COOKIE_NAME)
  return parseConsentCookie(raw, Date.now())
}

export function isConsentAccepted() {
  return isAcceptedState(getStoredConsentState())
}

/**
 * Persist a decision. Only 'accepted' | 'rejected' | 'withdrawn' are
 * ever written — 'unknown' is never stored (it is the absence of a
 * cookie, not a value), matching serializeConsentValue's own contract.
 */
export function setStoredConsentState(state) {
  if (typeof document === 'undefined') return
  const value = serializeConsentValue(state, Date.now())
  const secureFlag = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
  const maxAgeSeconds = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax${secureFlag}`
}

export { CONSENT_STATES }
