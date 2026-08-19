/**
 * Whether a fetch-controlled upload stage should be retried for a given
 * HTTP status. 429 (rate limited) is never retryable — retrying it just
 * amplifies load against an already-exceeded bucket. 422 (deterministic
 * source-content rejection — STEP 7.15g) is never retryable either: the
 * server already decoded the exact same immutable bytes once and rejected
 * them for cause, so a retry can only ever reproduce the same 422. Every
 * other status (5xx, other 4xx — including 503, the validator's transient/
 * infrastructure-unavailable response) stays retryable here; callers still
 * classify specific bodies (e.g. photo_count) as nonRetryable separately.
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableUploadHttpStatus(status) {
  return status !== 429 && status !== 422
}

/**
 * Run tasks with limited concurrency.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} concurrency
 * @returns {Promise<Array<any>>}
 */
export async function runWithConcurrency(tasks, concurrency = 3) {
  const results = new Array(tasks.length)
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++
      results[currentIndex] = await tasks[currentIndex]()
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
