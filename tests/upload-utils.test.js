import { describe, it, expect } from 'vitest'
import { isRetryableUploadHttpStatus, runWithConcurrency } from '@/lib/upload-utils'

// STEP 7.13a — pure classification helper backing the Guest upload retry
// loop's "429 is never retryable" rule. Behavior-tested directly: no
// mocking needed since the function is a pure status -> boolean predicate.

describe('isRetryableUploadHttpStatus', () => {
  it('429 (rate limited) is never retryable', () => {
    expect(isRetryableUploadHttpStatus(429)).toBe(false)
  })

  it('5xx transient statuses remain retryable', () => {
    expect(isRetryableUploadHttpStatus(500)).toBe(true)
    expect(isRetryableUploadHttpStatus(502)).toBe(true)
    expect(isRetryableUploadHttpStatus(503)).toBe(true)
    expect(isRetryableUploadHttpStatus(504)).toBe(true)
  })

  it('other 4xx statuses remain retryable at the status level (photo_count is classified separately, by body, before this check runs)', () => {
    expect(isRetryableUploadHttpStatus(400)).toBe(true)
    expect(isRetryableUploadHttpStatus(403)).toBe(true)
    expect(isRetryableUploadHttpStatus(404)).toBe(true)
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
