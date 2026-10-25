import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { nextRoomPollDelay } from '@/lib/room-poll'

const MIN = 60 * 1000

describe('nextRoomPollDelay', () => {
  it('polls every 5 s while photos are arriving', () => {
    expect(nextRoomPollDelay({ msSinceLastChange: 0 })).toBe(5000)
    expect(nextRoomPollDelay({ msSinceLastChange: 2 * MIN - 1 })).toBe(5000)
  })

  it('backs off as the room goes quiet, capped at 30 s', () => {
    expect(nextRoomPollDelay({ msSinceLastChange: 2 * MIN })).toBe(10000)
    expect(nextRoomPollDelay({ msSinceLastChange: 5 * MIN })).toBe(20000)
    expect(nextRoomPollDelay({ msSinceLastChange: 10 * MIN })).toBe(30000)
    expect(nextRoomPollDelay({ msSinceLastChange: 3 * 60 * MIN })).toBe(30000)
  })

  it('keeps the exponential error backoff when it is longer', () => {
    expect(nextRoomPollDelay({ msSinceLastChange: 0, consecutiveErrors: 2, errorBackoffMs: 12000 })).toBe(12000)
    expect(nextRoomPollDelay({ msSinceLastChange: 10 * MIN, consecutiveErrors: 1, errorBackoffMs: 6000 })).toBe(30000)
    expect(nextRoomPollDelay({ msSinceLastChange: 0, consecutiveErrors: 0, errorBackoffMs: 30000 })).toBe(5000)
  })

  it('treats bad input as active (never stops polling)', () => {
    expect(nextRoomPollDelay({ msSinceLastChange: NaN })).toBe(5000)
    expect(nextRoomPollDelay({ msSinceLastChange: -5 })).toBe(5000)
  })
})

describe('room page poll wiring', () => {
  const src = readFileSync('components/room-page-client.jsx', 'utf8')

  it('pauses while the tab is hidden and refreshes on return', () => {
    expect(src).toMatch(/document\.visibilityState === 'hidden'/)
    expect(src).toMatch(/addEventListener\('visibilitychange', onVisibilityChange\)/)
    expect(src).toMatch(/removeEventListener\('visibilitychange', onVisibilityChange\)/)
  })

  it('uses the adaptive delay instead of a fixed interval', () => {
    expect(src).toContain('nextRoomPollDelay({')
    expect(src).not.toMatch(/}, pollBackoffRef\.current\)/)
  })
})
