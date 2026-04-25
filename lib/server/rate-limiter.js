/**
 * Minimal in-memory rate limiter for serverless environments.
 *
 * Limitations:
 * - Memory is not shared across serverless instances.
 * - For production multi-instance deployments, replace with Redis / Upstash.
 *
 * Recommended upgrade path:
 *   npm install @upstash/ratelimit @upstash/redis
 *   Replace the functions below with UpstashRatelimit instances.
 */

const buckets = new Map()
const CLEANUP_THRESHOLD = 1000

function cleanupExpiredBuckets() {
  const now = Date.now()
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

/**
 * Check and increment a rate-limit bucket.
 *
 * @param {string} key - Unique bucket key (e.g. `login:ip:1.2.3.4`)
 * @param {number} maxAttempts - Maximum allowed attempts in the window
 * @param {number} windowMs - Window size in milliseconds
 * @returns {{ limited: boolean, retryAfter?: number }}
 */
export function rateLimit(key, maxAttempts, windowMs) {
  if (buckets.size > CLEANUP_THRESHOLD) {
    cleanupExpiredBuckets()
  }

  const now = Date.now()
  const entry = buckets.get(key)

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false }
  }

  if (entry.count >= maxAttempts) {
    return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }

  entry.count += 1
  return { limited: false }
}

/**
 * Extract a client IP from a Next.js Request object.
 * Handles Vercel / common reverse-proxy headers.
 *
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  return 'unknown'
}

/**
 * Convenience helpers for common auth limits.
 * All windows are in milliseconds.
 */
export const AUTH_LIMITS = {
  login: { ip: { max: 5, window: 15 * 60 * 1000 }, email: { max: 5, window: 15 * 60 * 1000 } },
  forgotPassword: { ip: { max: 5, window: 30 * 60 * 1000 }, email: { max: 3, window: 30 * 60 * 1000 } },
  setup: { ip: { max: 5, window: 30 * 60 * 1000 } },
  reset: { ip: { max: 5, window: 30 * 60 * 1000 } },
  session: { ip: { max: 5, window: 15 * 60 * 1000 }, email: { max: 5, window: 15 * 60 * 1000 } },
  resend: { ip: { max: 5, window: 30 * 60 * 1000 }, email: { max: 3, window: 30 * 60 * 1000 } },
}

/**
 * Broader rate limits for upload, event creation, and email endpoints.
 */
export const RATE_LIMITS = {
  createEvent: { ip: { max: 10, window: 60 * 60 * 1000 } },
  sendEventEmail: { ip: { max: 5, window: 60 * 60 * 1000 } },
  uploadInit: { ip: { max: 30, window: 10 * 60 * 1000 } },
  uploadBlob: { ip: { max: 30, window: 10 * 60 * 1000 } },
  uploadChunk: { ip: { max: 200, window: 10 * 60 * 1000 } },
  uploadComplete: { ip: { max: 30, window: 10 * 60 * 1000 } },
}
