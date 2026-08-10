import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Unit coverage for FASE 2: checkRateLimit() must describe backend state
// (backend/degraded/backendError) additively, without ever using `limited`
// as a stand-in for a backend failure. Policy (fail-open vs fail-closed) is
// decided by callers, not by checkRateLimit() itself.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const ORIGINAL_ENV = { ...process.env }

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function installRedisMock(evalMock, ttlMock) {
  return (async () => {
    const { Redis } = await import('@upstash/redis')
    Redis.mockImplementation(function () {
      return { eval: evalMock, ttl: ttlMock }
    })
  })()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
})

afterEach(() => {
  restoreEnv()
})

// --- A. Redis healthy, under limit ---

it('A: Redis healthy, under limit — backend=redis, degraded=false, backendError=false', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  const evalMock = vi.fn().mockResolvedValue(1)
  const ttlMock = vi.fn()
  await installRedisMock(evalMock, ttlMock)

  const { checkRateLimit } = await import('@/lib/server/rate-limiter')
  const result = await checkRateLimit('test:a', 5, 60000)

  expect(result).toEqual({
    limited: false,
    backend: 'redis',
    degraded: false,
    backendError: false,
  })
})

// --- B. Redis healthy, over limit ---

it('B: Redis healthy, over limit — limited=true, correct retryAfter, backendError=false', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  const evalMock = vi.fn().mockResolvedValue(6)
  const ttlMock = vi.fn().mockResolvedValue(123)
  await installRedisMock(evalMock, ttlMock)

  const { checkRateLimit } = await import('@/lib/server/rate-limiter')
  const result = await checkRateLimit('test:b', 5, 60000)

  expect(result).toEqual({
    limited: true,
    retryAfter: 123,
    backend: 'redis',
    degraded: false,
    backendError: false,
  })
})

// --- C. Redis not configured ---

it('C: Redis not configured — backend=memory, degraded=false, backendError=false', async () => {
  const { checkRateLimit } = await import('@/lib/server/rate-limiter')
  const result = await checkRateLimit('test:c', 5, 60000)

  expect(result).toEqual({
    limited: false,
    backend: 'memory',
    degraded: false,
    backendError: false,
  })
})

// --- D. eval() throws ---

it('D: eval() throws — backend=memory, degraded=true, backendError=true', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
  const ttlMock = vi.fn()
  await installRedisMock(evalMock, ttlMock)

  const { checkRateLimit } = await import('@/lib/server/rate-limiter')
  const result = await checkRateLimit('test:d', 5, 60000)

  expect(result.backend).toBe('memory')
  expect(result.degraded).toBe(true)
  expect(result.backendError).toBe(true)
  expect(typeof result.limited).toBe('boolean')
})

// --- E. ttl() throws after eval() already reported count > max ---

describe('E: ttl() throws — documents the whole-call failure behavior', () => {
  it('the already-known "count exceeded" fact from eval() is discarded; the call is treated as a full backend failure', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
    // eval() succeeds and reports the count is over the limit...
    const evalMock = vi.fn().mockResolvedValue(6)
    // ...but ttl() fails while fetching the retryAfter value.
    const ttlMock = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'))
    await installRedisMock(evalMock, ttlMock)

    const { checkRateLimit } = await import('@/lib/server/rate-limiter')
    const result = await checkRateLimit('test:e', 5, 60000)

    // Documented behavior: NOT limited:true from Redis's confirmed answer —
    // the entire redisRateLimit() call is caught as a single failure and
    // degrades to the in-memory bucket's own (unrelated) verdict instead.
    expect(result.backend).toBe('memory')
    expect(result.degraded).toBe(true)
    expect(result.backendError).toBe(true)
    // A fresh in-memory bucket for this key has never been touched before,
    // so the local fallback reports not-limited — even though Redis had
    // already confirmed the quota was exceeded moments earlier.
    expect(result.limited).toBe(false)
  })
})

// --- F. logging throttle ---

it('F: multiple Redis errors within 30s produce at most one console.error', async () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
  const evalMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
  const ttlMock = vi.fn()
  await installRedisMock(evalMock, ttlMock)

  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { checkRateLimit } = await import('@/lib/server/rate-limiter')

  await checkRateLimit('test:f:1', 5, 60000)
  await checkRateLimit('test:f:2', 5, 60000)
  await checkRateLimit('test:f:3', 5, 60000)

  const rateLimitErrorLogs = errorSpy.mock.calls.filter((call) => call[0] === '[rate-limit] Redis rate limit failed:')
  expect(rateLimitErrorLogs.length).toBe(1)

  errorSpy.mockRestore()
})
