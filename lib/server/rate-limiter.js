/**
 * Rate limiter with Upstash Redis support and in-memory fallback.
 *
 * Production: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 * Development / missing Redis: falls back to in-memory buckets.
 *
 * For payment and critical auth endpoints, configure Redis before going live.
 */

import { Redis } from '@upstash/redis'
import { createHash } from 'crypto'

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

function getRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    return new Redis({ url, token })
  } catch (error) {
    console.error('[rate-limit] Failed to create Redis client:', error.message)
    return null
  }
}

const redisClient = typeof window === 'undefined' ? getRedisClient() : null

const RATE_LIMIT_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`

async function redisRateLimit(key, maxAttempts, windowMs) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
  const count = await redisClient.eval(RATE_LIMIT_SCRIPT, [key], [windowSeconds])
  if (Number(count) > maxAttempts) {
    // If ttl() throws here, the exception propagates out of redisRateLimit
    // and is caught by checkRateLimit's catch block below, same as an
    // eval() failure — the already-known "count exceeded" fact is discarded
    // and the call is treated as a backend failure as a whole. This is
    // intentional: keeping a single failure path avoids a second, more
    // complex branch for a rare partial-failure case (see FASE 2 audit).
    const ttl = await redisClient.ttl(key)
    return { limited: true, retryAfter: Math.max(Number(ttl) || 1, 1) }
  }
  return { limited: false }
}

// In-memory bucket check — identical logic/semantics to the pre-FASE-2
// implementation (same window/retryAfter behavior), only extracted into a
// named function so both the "Redis not configured" and "Redis errored"
// paths in checkRateLimit can share it without duplicating the body.
function checkMemoryRateLimit(key, maxAttempts, windowMs) {
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

let lastRedisErrorLogAt = 0
const REDIS_ERROR_LOG_INTERVAL_MS = 30_000

/**
 * Check and increment a rate-limit bucket.
 * Uses Redis when configured; otherwise falls back to in-memory buckets.
 *
 * Returns { limited, retryAfter?, backend, degraded, backendError }.
 * `limited` always means exactly one thing: the quota was genuinely
 * exceeded (by Redis when backend === 'redis', or by the local in-memory
 * bucket otherwise) — it is never a stand-in for a backend failure.
 * `backendError` signals that Redis is configured but failed at runtime for
 * this call; callers that need a fail-closed policy (e.g. AUTH_CRITICAL
 * endpoints) should check backendError explicitly rather than infer it from
 * `limited`. checkRateLimit itself never decides fail-open vs fail-closed —
 * that policy decision belongs entirely to the caller.
 */
export async function checkRateLimit(key, maxAttempts, windowMs) {
  if (redisClient) {
    try {
      const result = await redisRateLimit(key, maxAttempts, windowMs)
      return { ...result, backend: 'redis', degraded: false, backendError: false }
    } catch (error) {
      const now = Date.now()
      if (now - lastRedisErrorLogAt > REDIS_ERROR_LOG_INTERVAL_MS) {
        console.error('[rate-limit] Redis rate limit failed:', error.message)
        lastRedisErrorLogAt = now
      }
      // Fail-open to in-memory only in this fallback path.
      const memoryResult = checkMemoryRateLimit(key, maxAttempts, windowMs)
      return { ...memoryResult, backend: 'memory', degraded: true, backendError: true }
    }
  }

  const memoryResult = checkMemoryRateLimit(key, maxAttempts, windowMs)
  return { ...memoryResult, backend: 'memory', degraded: false, backendError: false }
}

/**
 * @deprecated Use checkRateLimit for new code.
 * Synchronous in-memory rate limiter kept for backward compatibility.
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
 */
export function getClientIp(request) {
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}

export function hashIdentifier(value) {
  if (!value || value === 'unknown') return 'unknown'
  return createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex')
}

// Convenience helpers for common auth limits.
export const AUTH_LIMITS = {
  login: { ip: { max: 5, window: 15 * 60 * 1000 }, email: { max: 5, window: 15 * 60 * 1000 } },
  forgotPassword: { ip: { max: 5, window: 30 * 60 * 1000 }, email: { max: 3, window: 30 * 60 * 1000 } },
  setup: { ip: { max: 5, window: 30 * 60 * 1000 }, token: { max: 10, window: 15 * 60 * 1000 } },
  reset: { ip: { max: 5, window: 30 * 60 * 1000 }, token: { max: 10, window: 15 * 60 * 1000 } },
  session: { ip: { max: 5, window: 15 * 60 * 1000 }, email: { max: 5, window: 15 * 60 * 1000 } },
  resend: { ip: { max: 5, window: 30 * 60 * 1000 }, email: { max: 3, window: 30 * 60 * 1000 } },
}

export const PAYMENT_LIMITS = {
  checkoutSession: { owner: { max: 10, window: 10 * 60 * 1000 } },
  checkoutExtraEvent: { owner: { max: 5, window: 10 * 60 * 1000 } },
  checkoutProfessional: { owner: { max: 5, window: 10 * 60 * 1000 } },
  customerPortal: { owner: { max: 5, window: 10 * 60 * 1000 }, ip: { max: 20, window: 10 * 60 * 1000 } },
  unlockDownload: { ip: { max: 10, window: 10 * 60 * 1000 }, owner: { max: 5, window: 10 * 60 * 1000 } },
}

export const OWNER_WRITE_LIMITS = {
  createEvent: { owner: { max: 10, window: 60 * 60 * 1000 }, ip: { max: 20, window: 60 * 60 * 1000 } },
  updateEvent: { owner: { max: 60, window: 10 * 60 * 1000 } },
  deleteEvent: { owner: { max: 20, window: 60 * 60 * 1000 } },
  deletePhoto: { owner: { max: 60, window: 10 * 60 * 1000 } },
  coverUpload: { owner: { max: 10, window: 10 * 60 * 1000 }, ip: { max: 10, window: 10 * 60 * 1000 } },
  coverDelete: { owner: { max: 20, window: 60 * 60 * 1000 } },
  momentsWrite: { owner: { max: 60, window: 10 * 60 * 1000 } },
  privateDeliveryWrite: { owner: { max: 60, window: 10 * 60 * 1000 } },
  photographerLinkWrite: { owner: { max: 20, window: 60 * 60 * 1000 } },
  galleryJobCreate: { owner: { max: 5, window: 30 * 60 * 1000 } },
}

export const ADMIN_LIMITS = {
  login: { ip: { max: 5, window: 15 * 60 * 1000 } },
  write: { ip: { max: 60, window: 10 * 60 * 1000 }, admin: { max: 100, window: 10 * 60 * 1000 } },
}

// Broader rate limits for upload, event creation, and email endpoints.
export const RATE_LIMITS = {
  createEvent: { ip: { max: 10, window: 60 * 60 * 1000 } },
  sendEventEmail: { ip: { max: 5, window: 60 * 60 * 1000 } },
  uploadInit: { ip: { max: 30, window: 10 * 60 * 1000 } },
  uploadBlob: { ip: { max: 30, window: 10 * 60 * 1000 } },
  uploadChunk: { ip: { max: 200, window: 10 * 60 * 1000 } },
  uploadComplete: { ip: { max: 30, window: 10 * 60 * 1000 } },
  coverUpload: { ip: { max: 10, window: 10 * 60 * 1000 }, owner: { max: 10, window: 10 * 60 * 1000 } },
  publicEventUpdate: { ip: { max: 30, window: 10 * 60 * 1000 } },
  publicEventDelete: { ip: { max: 10, window: 60 * 60 * 1000 } },
  galleryDownloadCreate: { ip: { max: 5, window: 30 * 60 * 1000 } },
  analyticsLog: { ip: { max: 60, window: 10 * 60 * 1000 } },
  // Broad, Redis-backed, hashed-IP pre-resolution guard on the shared
  // /api/uploads/blob token-generation branch. Sits before the
  // BlobUploadSession lookup used to identify the PHOTOGRAPHER_UPLOAD
  // branch below — deliberately much higher than every per-flow policy it
  // sits in front of, since its job is gross pre-DB abuse protection, not
  // product-level throttling. Guest/room-photo and private-delivery blob
  // requests still fall through to the unchanged uploadBlob.ip entry above.
  uploadBlobBroad: { ip: { max: 1000, window: 10 * 60 * 1000 } },
  // Broad, Redis-backed, hashed-IP pre-auth guards for the photographer
  // init/complete endpoints. The raw photographer token is
  // attacker-controlled until getPhotographerEventFromToken() validates
  // it (a DB lookup) — a flood of arbitrary/random tokens from one IP
  // would otherwise mint a fresh photographer-init/complete token-hash
  // bucket AND hit the DB once per request, since that per-token limiter
  // alone provides no protection against an ever-changing token string.
  // Separate categories per stage (not one shared bucket) so a normal
  // one-init-plus-one-complete upload never double-charges against a
  // single combined ceiling.
  photographerInitBroad: { ip: { max: 1000, window: 10 * 60 * 1000 } },
  photographerCompleteBroad: { ip: { max: 1000, window: 10 * 60 * 1000 } },
  // Photographer-token-scoped (hashPhotographerUploadToken), Redis-backed.
  photographerInit: { token: { max: 200, window: 10 * 60 * 1000 } },
  photographerComplete: { token: { max: 200, window: 10 * 60 * 1000 } },
  // eventId-scoped (BlobUploadSession.eventId), not token-hash-scoped —
  // the original authorizing token is not stored on BlobUploadSession, and
  // resolving the *current* event token hash would misattribute sessions
  // created under a since-rotated/revoked token to the new token's bucket.
  photographerBlobEvent: { event: { max: 200, window: 10 * 60 * 1000 } },
}
