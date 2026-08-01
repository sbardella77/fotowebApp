import { describe, it, expect } from 'vitest'
import { addDays, addMonths } from 'date-fns'
import { resolveEventRetentionState } from '@/lib/event-retention'

const JAN_1 = new Date('2026-01-01T00:00:00.000Z')
const JUN_1 = new Date('2026-06-01T00:00:00.000Z')
const JUN_15 = new Date('2026-06-15T00:00:00.000Z')
const OCT_1 = new Date('2026-10-01T00:00:00.000Z')
const MAR_15 = new Date('2026-03-15T00:00:00.000Z')

function makeEvent(overrides = {}) {
  return {
    createdAt: JAN_1,
    billingTier: null,
    vaultExtendedUntil: null,
    gracePeriodUntil: null,
    archiveLocked: false,
    ...overrides,
  }
}

describe('resolveEventRetentionState', () => {
  // ── SCENARIO A: FREE ──
  it('free event → 90 days from createdAt', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: null,
      now: MAR_15,
    })

    expect(state.policy).toBe('free_90_days')
    expect(state.retentionUntil).toEqual(addDays(JAN_1, 90))
    expect(state.isExpired).toBe(false)
    expect(state.gracePeriodActive).toBe(false)
    expect(state.labelKey).toBe('storedUntil')
  })

  it('free event → expired after 90 days', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: null,
      now: new Date('2026-05-01T00:00:00.000Z'),
    })

    expect(state.policy).toBe('free_90_days')
    expect(state.isExpired).toBe(true)
  })

  // ── SCENARIO B: PRO EVENT ──
  it('pro_event → 12 months from createdAt', () => {
    const state = resolveEventRetentionState({
      event: makeEvent({ billingTier: 'pro_event' }),
      ownerPlan: null,
      now: MAR_15,
    })

    expect(state.policy).toBe('pro_event_12_months')
    expect(state.retentionUntil).toEqual(addMonths(JAN_1, 12))
    expect(state.isExpired).toBe(false)
    expect(state.gracePeriodActive).toBe(false)
  })

  // ── SCENARIO C: WEDDING PRO ──
  it('wedding_pro → 24 months from createdAt', () => {
    const state = resolveEventRetentionState({
      event: makeEvent({ billingTier: 'wedding_pro' }),
      ownerPlan: null,
      now: MAR_15,
    })

    expect(state.policy).toBe('wedding_pro_24_months')
    expect(state.retentionUntil).toEqual(addMonths(JAN_1, 24))
    expect(state.isExpired).toBe(false)
    expect(state.gracePeriodActive).toBe(false)
  })

  // ── SCENARIO D: PROFESSIONAL ACTIVE ──
  it('professional active → no fixed expiration', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: 'professional',
      now: MAR_15,
    })

    expect(state.policy).toBe('professional_active')
    expect(state.retentionUntil).toBeNull()
    expect(state.isExpired).toBe(false)
    expect(state.isExpiringSoon).toBe(false)
    expect(state.gracePeriodActive).toBe(false)
    expect(state.labelKey).toBe('storedWhileSubscriptionActive')
  })

  it('business active → same as professional', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: 'business',
      now: MAR_15,
    })

    expect(state.policy).toBe('professional_active')
    expect(state.retentionUntil).toBeNull()
  })

  // ── SCENARIO E: PROFESSIONAL CANCELLED + GRACE PERIOD ──
  it('professional cancelled within 90 days → grace period active', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: null, // plan already downgraded to free
      ownerSubscriptionCanceledAt: JUN_1,
      now: JUN_15,
    })

    expect(state.policy).toBe('professional_grace_90_days')
    expect(state.gracePeriodActive).toBe(true)
    expect(state.isExpired).toBe(false)
    expect(state.retentionUntil).toEqual(addDays(JUN_1, 90))
    expect(state.labelKey).toBe('storedUntil')
  })

  // ── SCENARIO F: PROFESSIONAL CANCELLED AFTER GRACE ──
  it('professional cancelled after grace period → expired', () => {
    const state = resolveEventRetentionState({
      event: makeEvent(),
      ownerPlan: null,
      ownerSubscriptionCanceledAt: JUN_1,
      now: OCT_1,
    })

    expect(state.policy).toBe('professional_grace_90_days')
    expect(state.gracePeriodActive).toBe(true) // policy is still grace, but...
    expect(state.isExpired).toBe(true)
    expect(state.retentionUntil).toEqual(addDays(JUN_1, 90))
  })

  // ── SCENARIO G: VAULT EXTENDED ──
  it('vault extension active → coveredByVault', () => {
    const vaultDate = new Date('2026-12-31T00:00:00.000Z')
    const state = resolveEventRetentionState({
      event: makeEvent({ vaultExtendedUntil: vaultDate }),
      ownerPlan: null,
      now: MAR_15,
    })

    expect(state.policy).toBe('vault_extended')
    expect(state.coveredByVault).toBe(true)
    expect(state.retentionUntil).toEqual(vaultDate)
    expect(state.isExpired).toBe(false)
    expect(state.canExtend).toBe(true)
  })

  // ── EDGE: archive locked ──
  it('archive locked → no expiration, archived policy', () => {
    const state = resolveEventRetentionState({
      event: makeEvent({ archiveLocked: true }),
      ownerPlan: null,
      now: MAR_15,
    })

    expect(state.policy).toBe('archived_locked')
    expect(state.retentionUntil).toBeNull()
    expect(state.isExpired).toBe(false)
    expect(state.canExtend).toBe(false)
  })

  // ── EDGE: event-level billingTier wins over cancelled ownerPlan ──
  it('pro_event event with cancelled subscription still uses pro_event retention', () => {
    const state = resolveEventRetentionState({
      event: makeEvent({ billingTier: 'pro_event' }),
      ownerPlan: null,
      ownerSubscriptionCanceledAt: JUN_1,
      now: OCT_1,
    })

    expect(state.policy).toBe('pro_event_12_months')
    expect(state.isExpired).toBe(false)
  })

  // ── SCENARIO E2: EXPLICIT gracePeriodUntil IS AN ABSOLUTE DEADLINE ──
  it('gracePeriodUntil is used directly as the retention deadline', () => {
    const graceUntil = new Date('2026-09-30T00:00:00.000Z')
    const state = resolveEventRetentionState({
      event: makeEvent({ gracePeriodUntil: graceUntil }),
      ownerPlan: null,
      now: JUN_15,
    })

    expect(state.policy).toBe('professional_grace_90_days')
    expect(state.gracePeriodActive).toBe(true)
    expect(state.retentionUntil).toEqual(graceUntil)
    expect(state.isExpired).toBe(false)
  })

  it('gracePeriodUntil takes precedence over ownerSubscriptionCanceledAt', () => {
    const graceUntil = new Date('2026-07-15T00:00:00.000Z')
    const state = resolveEventRetentionState({
      event: makeEvent({ gracePeriodUntil: graceUntil }),
      ownerPlan: null,
      ownerSubscriptionCanceledAt: JUN_1,
      now: JUN_15,
    })

    expect(state.retentionUntil).toEqual(graceUntil)
    expect(state.isExpired).toBe(false)
  })
})
