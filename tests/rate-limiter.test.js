import { describe, it, expect } from 'vitest'
import { checkRateLimit, rateLimit, hashIdentifier, OWNER_WRITE_LIMITS, PAYMENT_LIMITS } from '@/lib/server/rate-limiter'

describe('Rate limiter', () => {
  it('allows requests under the limit', () => {
    const result = rateLimit('test:ip:1', 5, 60000)
    expect(result.limited).toBe(false)
  })

  it('blocks requests over the limit', () => {
    const key = 'test:ip:2'
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60000).limited).toBe(false)
    }
    const result = rateLimit(key, 5, 60000)
    expect(result.limited).toBe(true)
    expect(typeof result.retryAfter).toBe('number')
  })

  it('resets bucket after window', async () => {
    const key = 'test:ip:3'
    rateLimit(key, 1, 10)
    expect(rateLimit(key, 1, 10).limited).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rateLimit(key, 1, 10).limited).toBe(false)
  })

  it('hashes identifiers deterministically', () => {
    const a = hashIdentifier('Owner@Example.com')
    const b = hashIdentifier('owner@example.com')
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('defines owner write limits', () => {
    expect(OWNER_WRITE_LIMITS.updateEvent.owner.max).toBeGreaterThan(0)
    expect(OWNER_WRITE_LIMITS.deleteEvent.owner.max).toBeGreaterThan(0)
  })

  it('defines payment limits', () => {
    expect(PAYMENT_LIMITS.checkoutSession.owner.max).toBeGreaterThan(0)
    expect(PAYMENT_LIMITS.checkoutExtraEvent.owner.max).toBeGreaterThan(0)
  })

  it('checkRateLimit falls back to in-memory when Redis is not configured', async () => {
    const result = await checkRateLimit('test:async:1', 5, 60000)
    expect(result.limited).toBe(false)
  })
})
