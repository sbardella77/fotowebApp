import { describe, it, expect } from 'vitest'
import { isRetryableUploadHttpStatus, runWithConcurrency } from '@/lib/upload-utils'

// STEP 7.13a — pure classification helper backing the Guest upload retry
// loop's "429 is never retryable" rule. Behavior-tested directly: no
// mocking needed since the function is a pure status -> boolean predicate.
//
// STEP 7.15g.1 narrowly added 422 to the non-retryable set: the server's
// source-integrity validator (STEP 7.15g) rejects already-fetched, immutable
// bytes deterministically, so a 422 can never turn into a different result
// on retry. This is a two-value delta only — every other status pinned
// below (including 503, the validator's own transient/infrastructure-
// unavailable response) is unchanged from pre-STEP-7.15g.1 behavior.

describe('isRetryableUploadHttpStatus', () => {
  it('429 (rate limited) is never retryable', () => {
    expect(isRetryableUploadHttpStatus(429)).toBe(false)
  })

  it('merge-blocking: 422 (deterministic invalid/mismatched image content) is never retryable', () => {
    expect(isRetryableUploadHttpStatus(422)).toBe(false)
  })

  it('5xx transient statuses remain retryable, including 503 (image_validation_unavailable must stay retryable)', () => {
    expect(isRetryableUploadHttpStatus(500)).toBe(true)
    expect(isRetryableUploadHttpStatus(502)).toBe(true)
    expect(isRetryableUploadHttpStatus(503)).toBe(true)
    expect(isRetryableUploadHttpStatus(504)).toBe(true)
  })

  it('every other 4xx status is unchanged from pre-STEP-7.15g.1 behavior — still retryable at the status level (photo_count is classified separately, by body, before this check runs)', () => {
    expect(isRetryableUploadHttpStatus(400)).toBe(true)
    expect(isRetryableUploadHttpStatus(401)).toBe(true)
    expect(isRetryableUploadHttpStatus(403)).toBe(true)
    expect(isRetryableUploadHttpStatus(404)).toBe(true)
    expect(isRetryableUploadHttpStatus(408)).toBe(true)
    expect(isRetryableUploadHttpStatus(413)).toBe(true)
  })

  it('2xx is retryable by definition (never actually consulted on a success path)', () => {
    expect(isRetryableUploadHttpStatus(200)).toBe(true)
    expect(isRetryableUploadHttpStatus(201)).toBe(true)
  })
})

describe('runWithConcurrency (regression — untouched by this STEP)', () => {
  it('still runs all tasks and preserves result order at the default concurrency', async () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => async () => n * 10)
    const results = await runWithConcurrency(tasks)
    expect(results).toEqual([10, 20, 30, 40, 50])
  })
})
