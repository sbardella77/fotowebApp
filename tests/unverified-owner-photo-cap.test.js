import { describe, it, expect, vi } from 'vitest'
import { checkRoomUploadEntitlement, resolveFreeRoomPhotoLimit, UNVERIFIED_PHOTO_LIMIT } from '@/lib/server/entitlements'

function makePrisma({ owner = null, photoCount = 0 } = {}) {
  return {
    owner: { findUnique: vi.fn().mockResolvedValue(owner) },
    photo: { count: vi.fn().mockResolvedValue(photoCount) },
  }
}

const freeOwner = (overrides = {}) => ({
  plan: 'free',
  subscriptionStatus: null,
  subscriptionGraceUntil: null,
  emailVerifiedAt: null,
  ...overrides,
})

describe('resolveFreeRoomPhotoLimit', () => {
  it('caps unverified owners lower and points them to verification, not pricing', () => {
    expect(resolveFreeRoomPhotoLimit({ ownerEmailVerified: false })).toEqual({ max: 30, upgradePath: 'verify_email', reason: 'email_unverified' })
    expect(resolveFreeRoomPhotoLimit({ ownerEmailVerified: true })).toEqual({ max: 50, upgradePath: 'pro_event', reason: 'photo_count' })
    expect(UNVERIFIED_PHOTO_LIMIT).toBe(30)
  })
})

describe('checkRoomUploadEntitlement — email verification', () => {
  it('blocks a free room of an unverified owner at 30 photos', async () => {
    const prisma = makePrisma({ owner: freeOwner(), photoCount: 30 })
    const result = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', billingTier: null })
    expect(result).toMatchObject({ allowed: false, max: 30, upgradePath: 'verify_email', reason: 'email_unverified' })
  })

  it('allows a free room of an unverified owner below 30 photos', async () => {
    const prisma = makePrisma({ owner: freeOwner(), photoCount: 29 })
    const result = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', billingTier: null })
    expect(result).toMatchObject({ allowed: true, max: 30 })
  })

  it('keeps the normal 50-photo free cap once verified', async () => {
    const prisma = makePrisma({ owner: freeOwner({ emailVerifiedAt: new Date() }), photoCount: 30 })
    const allowed = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', billingTier: null })
    expect(allowed).toMatchObject({ allowed: true, max: 50 })

    prisma.photo.count.mockResolvedValue(50)
    const blocked = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', billingTier: null })
    expect(blocked).toMatchObject({ allowed: false, max: 50, upgradePath: 'pro_event' })
  })

  it('treats a room with no owner as unverified', async () => {
    const prisma = makePrisma({ photoCount: 30 })
    const result = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: null, billingTier: null })
    expect(result).toMatchObject({ allowed: false, max: 30, upgradePath: 'verify_email' })
    expect(prisma.owner.findUnique).not.toHaveBeenCalled()
  })

  it('reads verification even when the caller already supplied ownerPlan', async () => {
    const prisma = makePrisma({ owner: freeOwner(), photoCount: 30 })
    const result = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', ownerPlan: 'free', billingTier: null })
    expect(prisma.owner.findUnique).toHaveBeenCalled()
    expect(result).toMatchObject({ allowed: false, max: 30 })
  })

  it('does not cap paid rooms of unverified owners', async () => {
    const prisma = makePrisma({ owner: freeOwner(), photoCount: 500 })
    const result = await checkRoomUploadEntitlement(prisma, { id: 'e1', ownerId: 'o1', billingTier: 'pro_event' })
    expect(result).toMatchObject({ allowed: true, max: Infinity })
  })
})
