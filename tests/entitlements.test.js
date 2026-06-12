import { describe, it, expect } from 'vitest'
import { resolveRoomCreationEntitlement } from '@/lib/server/entitlements'

describe('resolveRoomCreationEntitlement', () => {
  it('free owner with 0 events can create one free event', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 0 })
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(0)
    expect(result.max).toBe(1)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('free owner with 1 event and no credits is blocked', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 1 })
    expect(result.allowed).toBe(false)
    expect(result.current).toBe(1)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(0)
    expect(result.upgradePath).toBe('professional')
    expect(result.oneTimePath).toBe('extra_event')
  })

  it('free owner with 1 event and 1 credit can create one more event', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 1, extraEventCredits: 1 })
    expect(result.allowed).toBe(true)
    expect(result.current).toBe(1)
    expect(result.max).toBe(1)
    expect(result.extraEventCredits).toBe(1)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('free owner with 2 events and 1 credit is blocked', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 2, extraEventCredits: 1 })
    expect(result.allowed).toBe(false)
    expect(result.current).toBe(2)
    expect(result.extraEventCredits).toBe(1)
    expect(result.upgradePath).toBe('professional')
    expect(result.oneTimePath).toBe('extra_event')
  })

  it('free owner with 1 event and 2 credits can create up to 3 events total', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 2, extraEventCredits: 2 })
    expect(result.allowed).toBe(true)

    const blocked = resolveRoomCreationEntitlement({ ownerPlan: 'free', currentRooms: 3, extraEventCredits: 2 })
    expect(blocked.allowed).toBe(false)
  })

  it('professional owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'professional', currentRooms: 100 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
    expect(result.upgradePath).toBeNull()
    expect(result.oneTimePath).toBeNull()
  })

  it('business owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'business', currentRooms: 50 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
  })

  it('legacy pro owner can create unlimited events', () => {
    const result = resolveRoomCreationEntitlement({ ownerPlan: 'pro', currentRooms: 10 })
    expect(result.allowed).toBe(true)
    expect(result.max).toBe(Infinity)
  })
})
