import { describe, it, expect } from 'vitest'
import {
  CONSENT_STATES,
  CONSENT_POLICY_VERSION,
  CONSENT_MAX_AGE_DAYS,
  parseConsentCookie,
  serializeConsentValue,
  isAcceptedState,
} from '@/lib/consent/state'

const DAY_MS = 24 * 60 * 60 * 1000

describe('parseConsentCookie — unknown/default behavior (PRIVACY-CONSENT-001B)', () => {
  it('returns unknown for no cookie, empty string, null, undefined, non-string', () => {
    expect(parseConsentCookie(undefined)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(null)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie('')).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(42)).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('returns unknown for a malformed value (wrong number of segments)', () => {
    expect(parseConsentCookie('garbage')).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie('v1:accepted')).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie('v1:accepted:123:extra')).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('returns unknown for an unrecognized policy version (forces re-consent after a policy change)', () => {
    const now = Date.now()
    expect(parseConsentCookie(`v0:accepted:${Math.floor(now / 1000)}`, now)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(`v2:accepted:${Math.floor(now / 1000)}`, now)).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('returns unknown for an invalid/unrecognized state value, including "unknown" itself (never stored)', () => {
    const now = Date.now()
    const ts = Math.floor(now / 1000)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:bogus:${ts}`, now)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:unknown:${ts}`, now)).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('returns unknown for a non-numeric, zero, or negative timestamp', () => {
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:notanumber`)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:0`)).toBe(CONSENT_STATES.UNKNOWN)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:-100`)).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('returns unknown for a timestamp in the future (clock skew / tampering) — never trusted as valid', () => {
    const now = Date.now()
    const futureSeconds = Math.floor((now + DAY_MS) / 1000)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:${futureSeconds}`, now)).toBe(CONSENT_STATES.UNKNOWN)
  })
})

describe('parseConsentCookie — valid, current decisions', () => {
  it('returns accepted/rejected/withdrawn for a well-formed, current, unexpired value', () => {
    const now = Date.now()
    const ts = Math.floor(now / 1000)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:${ts}`, now)).toBe(CONSENT_STATES.ACCEPTED)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:rejected:${ts}`, now)).toBe(CONSENT_STATES.REJECTED)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:withdrawn:${ts}`, now)).toBe(CONSENT_STATES.WITHDRAWN)
  })
})

describe('parseConsentCookie — expiry (collapses to unknown, never a separate stored state)', () => {
  it('returns unknown once the record is older than CONSENT_MAX_AGE_DAYS', () => {
    const now = Date.now()
    const expiredTs = Math.floor((now - (CONSENT_MAX_AGE_DAYS + 1) * DAY_MS) / 1000)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:${expiredTs}`, now)).toBe(CONSENT_STATES.UNKNOWN)
  })

  it('still returns the real state one second before the expiry boundary', () => {
    const now = Date.now()
    const almostExpiredTs = Math.floor((now - (CONSENT_MAX_AGE_DAYS * DAY_MS - 1000)) / 1000)
    expect(parseConsentCookie(`${CONSENT_POLICY_VERSION}:accepted:${almostExpiredTs}`, now)).toBe(CONSENT_STATES.ACCEPTED)
  })
})

describe('serializeConsentValue', () => {
  it('produces a value that parseConsentCookie reads back identically (round-trip)', () => {
    const now = Date.now()
    for (const state of [CONSENT_STATES.ACCEPTED, CONSENT_STATES.REJECTED, CONSENT_STATES.WITHDRAWN]) {
      const value = serializeConsentValue(state, now)
      expect(parseConsentCookie(value, now)).toBe(state)
    }
  })

  it('throws rather than silently persisting "unknown" or an invalid state', () => {
    expect(() => serializeConsentValue(CONSENT_STATES.UNKNOWN)).toThrow()
    expect(() => serializeConsentValue('bogus')).toThrow()
  })

  it('embeds the current CONSENT_POLICY_VERSION', () => {
    const value = serializeConsentValue(CONSENT_STATES.ACCEPTED)
    expect(value.startsWith(`${CONSENT_POLICY_VERSION}:`)).toBe(true)
  })
})

describe('isAcceptedState', () => {
  it('is true only for accepted, false for every other state', () => {
    expect(isAcceptedState(CONSENT_STATES.ACCEPTED)).toBe(true)
    expect(isAcceptedState(CONSENT_STATES.UNKNOWN)).toBe(false)
    expect(isAcceptedState(CONSENT_STATES.REJECTED)).toBe(false)
    expect(isAcceptedState(CONSENT_STATES.WITHDRAWN)).toBe(false)
    expect(isAcceptedState('garbage')).toBe(false)
    expect(isAcceptedState(undefined)).toBe(false)
  })
})
