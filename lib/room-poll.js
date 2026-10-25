/**
 * Cadence of the room page's background refresh (GET /api/events/:slug),
 * which keeps the "new photos available" banner and event details current.
 *
 * A fixed 3 s poll cost every open room ~20 requests/minute per viewer —
 * at a 200-guest event that is ~4,000 function invocations a minute, mostly
 * from idle tabs. The cadence now follows activity: fast while photos are
 * arriving, backing off to 30 s as the room goes quiet. Hidden tabs do not
 * poll at all (handled by the caller via the Page Visibility API).
 */

export const ROOM_POLL_STEPS = [
  // [quiet for at least (ms), poll every (ms)]
  [10 * 60 * 1000, 30_000],
  [5 * 60 * 1000, 20_000],
  [2 * 60 * 1000, 10_000],
  [0, 5_000],
]

/**
 * @param {object} params
 * @param {number} params.msSinceLastChange  time since the photo count last
 *   changed (or the page loaded / this tab uploaded)
 * @param {number} [params.consecutiveErrors]
 * @param {number} [params.errorBackoffMs]  existing exponential error backoff
 * @returns {number} delay before the next poll, in ms
 */
export function nextRoomPollDelay({ msSinceLastChange, consecutiveErrors = 0, errorBackoffMs = 0 }) {
  const quiet = Math.max(0, Number(msSinceLastChange) || 0)
  const step = ROOM_POLL_STEPS.find(([threshold]) => quiet >= threshold)
  const activityDelay = step ? step[1] : ROOM_POLL_STEPS[ROOM_POLL_STEPS.length - 1][1]
  return consecutiveErrors > 0 ? Math.max(activityDelay, errorBackoffMs) : activityDelay
}
