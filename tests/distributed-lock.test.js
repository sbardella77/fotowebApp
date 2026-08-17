import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// STEP 7.14b — narrow distributed mutex used by the branded-download
// derivative cache to guarantee at most one Sharp transform per photo per
// watermark version while Redis is reachable.
//
// The critical contract is that BACKEND_UNAVAILABLE is never conflated with
// HELD_BY_OTHER: conflating them would turn every request into a permanent
// waiter during a Redis outage instead of degrading to a local strategy.

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const ORIGINAL_ENV = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

async function setupRedis(impl) {
  const { Redis } = await import('@upstash/redis')
  Redis.mockImplementation(function () { return impl })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  restoreEnv()
  process.env.NODE_ENV = 'test'
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.example'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token'
})

afterEach(() => {
  restoreEnv()
})

describe('tryAcquireDistributedLock', () => {
  it('returns ACQUIRED when Redis SET NX EX succeeds', async () => {
    const setMock = vi.fn().mockResolvedValue('OK')
    await setupRedis({ set: setMock })
    const { tryAcquireDistributedLock, DISTRIBUTED_LOCK_OUTCOME } = await import('@/lib/server/rate-limiter')

    const result = await tryAcquireDistributedLock('lock:a', 25)

    expect(result.outcome).toBe(DISTRIBUTED_LOCK_OUTCOME.ACQUIRED)
  })

  it('issues SET with nx:true and the requested ex TTL', async () => {
    const setMock = vi.fn().mockResolvedValue('OK')
    await setupRedis({ set: setMock })
    const { tryAcquireDistributedLock } = await import('@/lib/server/rate-limiter')

    await tryAcquireDistributedLock('lock:a', 25)

    expect(setMock).toHaveBeenCalledWith('lock:a', expect.any(String), { nx: true, ex: 25 })
  })

  it('returns HELD_BY_OTHER when SET NX returns null', async () => {
    await setupRedis({ set: vi.fn().mockResolvedValue(null) })
    const { tryAcquireDistributedLock, DISTRIBUTED_LOCK_OUTCOME } = await import('@/lib/server/rate-limiter')

    const result = await tryAcquireDistributedLock('lock:a', 25)

    expect(result.outcome).toBe(DISTRIBUTED_LOCK_OUTCOME.HELD_BY_OTHER)
  })

  it('returns BACKEND_UNAVAILABLE when Redis throws — never fails closed', async () => {
    await setupRedis({ set: vi.fn().mockRejectedValue(new Error('ECONNRESET')) })
    const { tryAcquireDistributedLock, DISTRIBUTED_LOCK_OUTCOME } = await import('@/lib/server/rate-limiter')

    const result = await tryAcquireDistributedLock('lock:a', 25)

    expect(result.outcome).toBe(DISTRIBUTED_LOCK_OUTCOME.BACKEND_UNAVAILABLE)
  })

  it('returns BACKEND_UNAVAILABLE when Redis is not configured at all', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { tryAcquireDistributedLock, DISTRIBUTED_LOCK_OUTCOME } = await import('@/lib/server/rate-limiter')

    const result = await tryAcquireDistributedLock('lock:a', 25)

    expect(result.outcome).toBe(DISTRIBUTED_LOCK_OUTCOME.BACKEND_UNAVAILABLE)
  })

  it('never throws, whatever the backend does', async () => {
    await setupRedis({ set: vi.fn().mockRejectedValue(new Error('boom')) })
    const { tryAcquireDistributedLock } = await import('@/lib/server/rate-limiter')

    await expect(tryAcquireDistributedLock('lock:a', 25)).resolves.toBeTruthy()
  })

  it('clamps a sub-second TTL to at least 1 second', async () => {
    const setMock = vi.fn().mockResolvedValue('OK')
    await setupRedis({ set: setMock })
    const { tryAcquireDistributedLock } = await import('@/lib/server/rate-limiter')

    await tryAcquireDistributedLock('lock:a', 0.2)

    expect(setMock).toHaveBeenCalledWith('lock:a', expect.any(String), { nx: true, ex: 1 })
  })
})

describe('module surface', () => {
  it('does not export the raw Redis client', async () => {
    await setupRedis({ set: vi.fn() })
    const mod = await import('@/lib/server/rate-limiter')

    expect(mod.redisClient).toBeUndefined()
    expect(Object.keys(mod)).not.toContain('redisClient')
  })

  it('exposes the three lock outcomes as a frozen constant', async () => {
    const { DISTRIBUTED_LOCK_OUTCOME } = await import('@/lib/server/rate-limiter')

    expect(DISTRIBUTED_LOCK_OUTCOME).toEqual({
      ACQUIRED: 'ACQUIRED',
      HELD_BY_OTHER: 'HELD_BY_OTHER',
      BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
    })
    expect(Object.isFrozen(DISTRIBUTED_LOCK_OUTCOME)).toBe(true)
  })

  it('existing checkRateLimit behavior is unchanged by the lock addition', async () => {
    const counts = new Map()
    await setupRedis({
      set: vi.fn(),
      eval: vi.fn(async (_s, keys) => {
        const next = (counts.get(keys[0]) || 0) + 1
        counts.set(keys[0], next)
        return next
      }),
      ttl: vi.fn(async () => 300),
    })
    const { checkRateLimit } = await import('@/lib/server/rate-limiter')

    const first = await checkRateLimit('k', 2, 60_000)
    const second = await checkRateLimit('k', 2, 60_000)
    const third = await checkRateLimit('k', 2, 60_000)

    expect(first).toMatchObject({ limited: false, backend: 'redis', backendError: false })
    expect(second.limited).toBe(false)
    expect(third.limited).toBe(true)
  })
})
