import { describe, it, expect, vi } from 'vitest'

const { Redis } = vi.hoisted(() => ({ Redis: vi.fn() }))
vi.mock('@upstash/redis', () => ({ Redis }))

describe('rate limiter Redis client', () => {
  it('is configured to fail fast instead of the ~4.3 s default retry backoff', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
    vi.resetModules()
    await import('@/lib/server/rate-limiter')

    const config = Redis.mock.calls.at(-1)[0]
    expect(config.retry.retries).toBe(1)
    expect(config.retry.backoff()).toBeLessThanOrEqual(100)
    const signal = config.signal()
    expect(signal).toBeInstanceOf(AbortSignal)
    vi.unstubAllEnvs()
  })
})
