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
    const ttl = await redisClient.ttl(key)
    return { limited: true, retryAfter: Math.max(Number(ttl) || 1, 1) }
  }
  return { limited: false }
}

/**
 * Check and increment a rate-limit bucket.
 * Uses Redis when configured; otherwise falls back to in-memory buckets.
 */
export async function checkRateLimit(key, maxAttempts, windowMs) {
  if (redisClient) {
    try {
      return await redisRateLimit(key, maxAttempts, windowMs)
    } catch (error) {
      console.error('[rate-limit] Redis rate limit failed:', error.message)
      // Fail-open to in-memory only in this fallback path.
    }
  }

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
}
