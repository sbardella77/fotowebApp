import { describe, it, expect } from 'vitest'
import { resolveRoomCreationEntitlement } from '@/lib/server/entitlements'

describe('resolveRoomCreationEntitlement', () => {
  it('free owner with 0 events can create one free event without consuming credits', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 0, extraEventCredits: 0 })
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(0)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(0)
    expect(result.consumeExtraCredit).toBe(false)
    expect(result.canBuyExtraEvent).toBe(false)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('free owner with 1 event and 0 credits is blocked', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 1, extraEventCredits: 0 })
    expect(result.allowed).toBe(false)
    expect(result.current).toBe(1)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(0)
    expect(result.consumeExtraCredit).toBe(false)
    expect(result.canBuyExtraEvent).toBe(true)
    expect(result.reason).toBe('room_count')
    expect(result.upgradePath).toBe('professional')
    expect(result.oneTimePath).toBe('extra_event')
  })

  it('free owner with 1 event and 1 credit can create one more event and consumes credit', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 1, extraEventCredits: 1 })
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(1)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(1)
    expect(result.consumeExtraCredit).toBe(true)
    expect(result.canBuyExtraEvent).toBe(false)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('free owner above limit with 1 credit can create and consumes credit (bug case)', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 2, extraEventCredits: 1 })
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(2)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(1)
    expect(result.consumeExtraCredit).toBe(true)
    expect(result.canBuyExtraEvent).toBe(false)
  })

  it('free owner with multiple rooms and multiple credits can create', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 5, extraEventCredits: 2 })
    expect(result.allowed).toBe(true)
    expect(result.consumeExtraCredit).toBe(true)
    expect(result.extraEventCredits).toBe(2)
  })

  it('free owner with multiple rooms and 0 credits is blocked', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 5, extraEventCredits: 0 })
    expect(result.allowed).toBe(false)
    expect(result.consumeExtraCredit).toBe(false)
    expect(result.canBuyExtraEvent).toBe(true)
    expect(result.upgradePath).toBe('professional')
    expect(result.oneTimePath).toBe('extra_event')
  })

  it('professional owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'professional', currentRooms: 100 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
    expect(result.consumeExtraCredit).toBe(false)
    expect(result.canBuyExtraEvent).toBe(false)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('business owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'business', currentRooms: 50 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
    expect(result.consumeExtraCredit).toBe(false)
  })

  it('legacy pro owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'pro', currentRooms: 10 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
    expect(result.consumeExtraCredit).toBe(false)
  })
})
