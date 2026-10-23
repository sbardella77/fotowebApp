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
 * Resolves immediately if the browser is already online (or in a
 * non-browser environment). Otherwise waits for the 'online' event, or for
 * maxWaitMs to elapse — whichever comes first — so a guest on flaky venue
 * wifi doesn't burn an upload retry attempt against a connection that's
 * known to be dead, but also never blocks forever if the browser's
 * online/offline signal turns out to be wrong.
 * @param {number} [maxWaitMs]
 * @returns {Promise<void>}
 */
export function waitForOnline(maxWaitMs = 120_000) {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => {
    const cleanup = () => {
      window.removeEventListener('online', onOnline)
      clearTimeout(timer)
    }
    const onOnline = () => {
      cleanup()
      resolve()
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, maxWaitMs)
    window.addEventListener('online', onOnline)
  })
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
