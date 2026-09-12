import { describe, it, expect } from 'vitest'
import {
  isSensitiveKey,
  sanitizeContext,
  redactMessage,
  serializeProviderError,
  SENSITIVE_KEY_SUBSTRINGS,
} from '@/lib/server/safe-log'

describe('isSensitiveKey / sanitizeContext', () => {
  it('flags email as sensitive alongside the pre-existing substrings', () => {
    expect(SENSITIVE_KEY_SUBSTRINGS).toContain('email')
    expect(isSensitiveKey('ownerEmail')).toBe(true)
    expect(isSensitiveKey('email')).toBe(true)
    expect(isSensitiveKey('EMAIL_ADDRESS')).toBe(true)
  })

  it('still flags every previously-established sensitive substring (regression)', () => {
    for (const key of ['password', 'token', 'cookie', 'secret', 'apiKey', 'authorization', 'cardNumber', 'cvc', 'cvv', 'stripeSecret', 'rawPayload']) {
      expect(isSensitiveKey(key)).toBe(true)
    }
  })

  it('keeps safe, non-PII keys', () => {
    for (const key of ['ownerId', 'eventId', 'photoId', 'eventSlug', 'durationMs']) {
      expect(isSensitiveKey(key)).toBe(false)
    }
  })

  it('also strips any key containing "stripe" (pre-existing, broader than just email) — a known observability trade-off, not a new gap this change introduces', () => {
    // sendOpsAlert's context sanitizer has always matched on the substring
    // "stripe", so stripeEventId/stripeSessionId/stripeCustomerId are
    // dropped from ops-alert context too, not just a raw Stripe event dump.
    // Documented here rather than silently changed, since narrowing it is
    // outside this task's scope.
    expect(isSensitiveKey('stripeCustomerId')).toBe(true)
    expect(isSensitiveKey('stripeEventId')).toBe(true)
  })

  it('strips sensitive keys (including email) from a context object, keeps safe ones', () => {
    const result = sanitizeContext({
      ownerId: 'owner-1',
      ownerEmail: 'person@example.com',
      csrfToken: 'secret-token',
      eventId: 'event-1',
    })
    expect(result).toEqual({ ownerId: 'owner-1', eventId: 'event-1' })
  })

  it('recurses into nested objects and arrays, still stripping sensitive keys', () => {
    const result = sanitizeContext({
      ownerId: 'owner-1',
      nested: { ownerEmail: 'a@b.com', eventId: 'event-1' },
      list: [{ token: 'x', photoId: 'p1' }],
    })
    expect(result).toEqual({
      ownerId: 'owner-1',
      nested: { eventId: 'event-1' },
      list: [{ photoId: 'p1' }],
    })
  })

  it('never throws on null/undefined/primitive input', () => {
    expect(sanitizeContext(null)).toBeNull()
    expect(sanitizeContext(undefined)).toBeNull()
    expect(sanitizeContext('plain string')).toBe('plain string')
    expect(sanitizeContext(42)).toBe(42)
  })
})

describe('redactMessage', () => {
  it('redacts an email address embedded in free text', () => {
    const out = redactMessage('duplicate key value violates unique constraint: (email)=(person@example.com) already exists')
    expect(out).not.toContain('person@example.com')
    expect(out).toContain('[REDACTED_EMAIL]')
  })

  it('redacts a URL (which may carry a signed-URL token in its query string)', () => {
    const out = redactMessage('fetch failed for https://abc123.private.blob.vercel-storage.com/private-delivery/wedding/x.jpg?token=abcd1234')
    expect(out).not.toContain('vercel-storage.com')
    expect(out).not.toContain('token=abcd1234')
    expect(out).toContain('[REDACTED_URL]')
  })

  it('redacts an Authorization header value', () => {
    const out = redactMessage('request failed, Authorization: Bearer sk_live_abcdefghijklmnopqrstuvwxyz012345 rejected')
    expect(out).not.toContain('sk_live_abcdefghijklmnopqrstuvwxyz012345')
    expect(out.toLowerCase()).toContain('[redacted]')
  })

  it('redacts a bare Bearer token', () => {
    const out = redactMessage('Bearer abcdefghijklmnopqrstuvwxyz0123456789 was invalid')
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789')
  })

  it('redacts a long opaque API-key-like string', () => {
    const out = redactMessage('key sk_test_51H9f2K7gQmZnc8pXrLtWvYbDjNaEoRsFuHiJkLmNoPqRs invalid')
    expect(out).not.toContain('51H9f2K7gQmZnc8pXrLtWvYbDjNaEoRsFuHiJkLmNoPqRs')
    expect(out).toContain('[REDACTED_TOKEN]')
  })

  it('does not redact short, legitimate operational identifiers', () => {
    // A UUID (dash-delimited) and a typical Stripe object id must survive —
    // these are ALLOW-classified per the logging policy and are exactly
    // what on-call engineers need to correlate an incident.
    const out = redactMessage('event 3450da0c-0000-4000-8000-000000000000 failed for customer cus_Q1a2B3c4D5e6F7')
    expect(out).toContain('3450da0c-0000-4000-8000-000000000000')
    expect(out).toContain('cus_Q1a2B3c4D5e6F7')
  })

  it('truncates very long messages to a bounded length', () => {
    // Space-separated words (each well under the opaque-token threshold) so
    // truncation, not token redaction, is what's under test here.
    const out = redactMessage('word '.repeat(200).trim())
    expect(out.length).toBeLessThan(1000)
    expect(out).toContain('[truncated]')
  })

  it('never throws on null, undefined, or non-string input', () => {
    expect(redactMessage(null)).toBe('no message')
    expect(redactMessage(undefined)).toBe('no message')
    expect(() => redactMessage(42)).not.toThrow()
    expect(() => redactMessage({ weird: 'object' })).not.toThrow()
  })
})

describe('serializeProviderError', () => {
  it('extracts only provider/operation/errorCode/safeMessage from a normal Error', () => {
    const error = new Error('failed to send to person@example.com')
    error.code = 'ESOMETHING'
    const result = serializeProviderError('resend', 'send_password_reset', error, 'req-123')

    expect(result).toEqual({
      provider: 'resend',
      operation: 'send_password_reset',
      errorCode: 'ESOMETHING',
      safeMessage: expect.stringContaining('[REDACTED_EMAIL]'),
      correlationId: 'req-123',
    })
    expect(result.safeMessage).not.toContain('person@example.com')
  })

  it('never spreads unknown/dangerous properties of the error object', () => {
    const error = new Error('boom')
    error.headers = { authorization: 'Bearer sk_live_verysecretvalue1234567890' }
    error.request = { body: { email: 'person@example.com', password: 'hunter2' } }
    error.response = { body: 'raw response payload' }

    const result = serializeProviderError('stripe', 'checkout_session_create', error)

    expect(Object.keys(result).sort()).toEqual(['errorCode', 'operation', 'provider', 'safeMessage'])
    expect(JSON.stringify(result)).not.toContain('sk_live_verysecretvalue1234567890')
    expect(JSON.stringify(result)).not.toContain('person@example.com')
    expect(JSON.stringify(result)).not.toContain('hunter2')
  })

  it('handles a plain string error without throwing', () => {
    const result = serializeProviderError('blob', 'delete_photo', 'plain string failure')
    expect(result.safeMessage).toBe('plain string failure')
    expect(result.errorCode).toBe('unknown')
  })

  it('handles null/undefined error without throwing', () => {
    expect(() => serializeProviderError('db', 'op', null)).not.toThrow()
    expect(() => serializeProviderError('db', 'op', undefined)).not.toThrow()
    expect(serializeProviderError('db', 'op', null).safeMessage).toBe('no message')
  })

  it('handles a non-Error plain object without throwing', () => {
    const result = serializeProviderError('db', 'op', { foo: 'bar' })
    expect(result.errorCode).toBe('unknown')
    expect(result.safeMessage).toBe('no message')
  })

  it('omits correlationId entirely when not provided', () => {
    const result = serializeProviderError('db', 'op', new Error('x'))
    expect(result).not.toHaveProperty('correlationId')
  })
})
