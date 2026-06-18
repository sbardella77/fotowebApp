import { describe, it, expect } from 'vitest'
import { resolveCreateRoomState } from '@/lib/create-room-state'

describe('resolveCreateRoomState', () => {
  it('free under limit → can create, no upsell', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'free', currentRooms: 0, extraEventCredits: 0 })
    expect(state.canCreateRoom).toBe(true)
    expect(state.showCreateEventUpsell).toBe(false)
    expect(state.hasExtraEventCredits).toBe(false)
    expect(state.isAccountUnlimited).toBe(false)
  })

  it('free limit reached with 0 credits → cannot create, upsell shown', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'free', currentRooms: 1, extraEventCredits: 0 })
    expect(state.canCreateRoom).toBe(false)
    expect(state.showCreateEventUpsell).toBe(true)
    expect(state.hasExtraEventCredits).toBe(false)
    expect(state.freeLimitReached).toBe(true)
  })

  it('free limit reached with 1 credit → can create, no upsell', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'free', currentRooms: 1, extraEventCredits: 1 })
    expect(state.canCreateRoom).toBe(true)
    expect(state.showCreateEventUpsell).toBe(false)
    expect(state.hasExtraEventCredits).toBe(true)
  })

  it('professional → can create, no upsell', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'professional', currentRooms: 100, extraEventCredits: 0 })
    expect(state.canCreateRoom).toBe(true)
    expect(state.showCreateEventUpsell).toBe(false)
    expect(state.isAccountUnlimited).toBe(true)
  })

  it('business → can create, no upsell', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'business', currentRooms: 50, extraEventCredits: 0 })
    expect(state.canCreateRoom).toBe(true)
    expect(state.showCreateEventUpsell).toBe(false)
    expect(state.isAccountUnlimited).toBe(true)
  })

  it('legacy pro → can create, no upsell', () => {
    const state = resolveCreateRoomState({ ownerPlan: 'pro', currentRooms: 10, extraEventCredits: 0 })
    expect(state.canCreateRoom).toBe(true)
    expect(state.showCreateEventUpsell).toBe(false)
    expect(state.isAccountUnlimited).toBe(true)
  })
})
