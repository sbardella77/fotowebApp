import { describe, it, expect, vi } from 'vitest'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'

// A scheduled cancellation whose period has ended must not keep premium even
// when the subscription-deleted webhook was missed: the server resolver has
// to read and pass subscriptionCancelAtPeriodEnd/subscriptionCurrentPeriodEnd.
function prismaWithOwner(owner) {
  return { owner: { findUnique: vi.fn().mockResolvedValue(owner) } }
}

const EVENT = { ownerId: 'owner-1', billingTier: null, originalDownloadUnlocked: false }

describe('getEffectiveEventAccessState — scheduled cancellation', () => {
  it('selects the cancellation fields', async () => {
    const prisma = prismaWithOwner({ plan: 'professional', subscriptionStatus: 'active' })
    await getEffectiveEventAccessState(prisma, EVENT)
    const { select } = prisma.owner.findUnique.mock.calls[0][0]
    expect(select).toMatchObject({ subscriptionCancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: true })
  })

  it('period over → not premium', async () => {
    const prisma = prismaWithOwner({ plan: 'professional', subscriptionStatus: 'active', subscriptionCancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: new Date(Date.now() - 60_000) })
    const state = await getEffectiveEventAccessState(prisma, EVENT)
    expect(state.accountPremium).toBe(false)
    expect(state.canUseCustomWatermark).toBe(false)
  })

  it('period not over → still premium', async () => {
    const prisma = prismaWithOwner({ plan: 'professional', subscriptionStatus: 'active', subscriptionCancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: new Date(Date.now() + 60_000) })
    const state = await getEffectiveEventAccessState(prisma, EVENT)
    expect(state.accountPremium).toBe(true)
  })
})
