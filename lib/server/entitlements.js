/**
 * SnapRooms plan entitlement resolution.
 *
 * Rules:
 * - Free owner: max 1 active room, max 50 photos per Free room
 * - Pro Event room: unlimited photos (does NOT grant unlimited rooms)
 * - Wedding Pro room: unlimited photos (does NOT grant unlimited rooms)
 * - Professional owner: unlimited rooms, unlimited photos
 * - Business owner: unlimited rooms, unlimited photos
 */

import { resolveEffectiveEventAccessState } from '@/lib/event-access'

const FREE_ROOM_LIMIT = 1
const FREE_PHOTO_LIMIT = 50

/**
 * Pure resolver for room creation entitlement.
 * Separated from the async DB check so it can be unit tested.
 */
export function resolveRoomCreationEntitlement({ ownerPlan, currentRooms, extraEventCredits = 0, freeRoomLimit = FREE_ROOM_LIMIT }) {
  const state = resolveEffectiveEventAccessState({ ownerPlan })
  if (state.canCreateUnlimitedRooms) {
    return { allowed: true, current: currentRooms, max: Infinity, extraEventCredits, upgradePath: null, oneTimePath: null }
  }

  const effectiveMax = freeRoomLimit + extraEventCredits
  if (currentRooms >= effectiveMax) {
    return {
      allowed: false,
      current: currentRooms,
      max: freeRoomLimit,
      extraEventCredits,
      upgradePath: 'professional',
      oneTimePath: 'extra_event',
    }
  }

  return { allowed: true, current: currentRooms, max: freeRoomLimit, extraEventCredits, upgradePath: null, oneTimePath: null }
}

/**
 * Check if an owner can create more rooms.
 * Returns {
 *   allowed: boolean,
 *   current: number,
 *   max: number,
 *   extraEventCredits: number,
 *   upgradePath: string|null,
 *   oneTimePath: string|null
 * }
 */
export async function checkOwnerRoomCreationEntitlement(prisma, owner) {
  if (!prisma || !owner) {
    return { allowed: true, current: 0, max: Infinity, extraEventCredits: 0, upgradePath: null, oneTimePath: null }
  }

  // Count active rooms for this owner
  const where = {
    OR: [
      { ownerId: owner.id },
      { ownerEmail: { equals: owner.email, mode: 'insensitive' } },
    ],
  }

  const current = await prisma.event.count({ where })
  const extraEventCredits = owner.extraEventCredits || 0

  return resolveRoomCreationEntitlement({
    ownerPlan: owner.plan,
    currentRooms: current,
    extraEventCredits,
    freeRoomLimit: FREE_ROOM_LIMIT,
  })
}

/**
 * Check if a room can accept more photo uploads.
 * Returns { allowed: boolean, current: number, max: number, upgradePath: string|null }
 */
export async function checkRoomUploadEntitlement(prisma, event) {
  if (!prisma || !event) {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Resolve owner plan when not already available
  let ownerPlan = event.ownerPlan ?? null
  if (ownerPlan == null && event.ownerId) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    ownerPlan = owner?.plan || null
  }

  const state = resolveEffectiveEventAccessState({ billingTier: event.billingTier, ownerPlan })
  if (state.canUploadUnlimited) {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Count visible photos for this room
  const current = await prisma.photo.count({
    where: {
      eventId: event.id,
      status: 'VISIBLE',
    },
  })

  if (current >= FREE_PHOTO_LIMIT) {
    return {
      allowed: false,
      current,
      max: FREE_PHOTO_LIMIT,
      upgradePath: 'pro_event',
    }
  }

  return { allowed: true, current, max: FREE_PHOTO_LIMIT, upgradePath: null }
}

/**
 * Check if an owner can use private professional delivery for a room.
 * Returns { allowed: boolean, upgradePath: string|null }
 *
 * Rules:
 * - Wedding Pro rooms: allowed
 * - Professional / Business owners: allowed for all their rooms
 * - Free / Pro Event: not allowed
 */
export async function checkPrivateDeliveryEntitlement(prisma, event) {
  if (!prisma || !event) {
    return { allowed: false, upgradePath: 'wedding_pro' }
  }

  // Resolve owner plan when not already available
  let ownerPlan = event.ownerPlan ?? null
  if (ownerPlan == null && event.ownerId) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    ownerPlan = owner?.plan || null
  }

  const state = resolveEffectiveEventAccessState({ billingTier: event.billingTier, ownerPlan })
  if (state.hasPrivateDelivery) {
    return { allowed: true, upgradePath: null }
  }

  return { allowed: false, upgradePath: 'wedding_pro' }
}

/**
 * Check if a photo download should be branded or unbranded.
 * Returns { branded: boolean }
 *
 * Rules:
 * - Free events → branded download
 * - Pro Event / Wedding Pro → unbranded
 * - Professional / Business owners → unbranded for all their events
 */
export async function checkPhotoDownloadEntitlement(prisma, event) {
  if (!event) {
    return { branded: true }
  }

  // Resolve owner plan when not already available
  let ownerPlan = event.ownerPlan ?? null
  if (ownerPlan == null && event.ownerId && prisma) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    ownerPlan = owner?.plan || null
  }

  const state = resolveEffectiveEventAccessState({
    billingTier: event.billingTier,
    originalDownloadUnlocked: event.originalDownloadUnlocked,
    ownerPlan,
  })

  return { branded: !state.hasUnbrandedDownloads }
}

/**
 * Check if gallery download is allowed for an event.
 * Returns { allowed: boolean, upgradePath: string|null }
 *
 * Rules:
 * - Free events → NOT allowed
 * - Pro Event → allowed for that specific event
 * - Wedding Pro → allowed for that specific event
 * - Professional / Business owners → allowed for all their events
 */
export async function checkGalleryDownloadEntitlement(prisma, event) {
  if (!event) {
    return { allowed: false, upgradePath: 'pro_event' }
  }

  // Resolve owner plan when not already available
  let ownerPlan = event.ownerPlan ?? null
  if (ownerPlan == null && event.ownerId && prisma) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    ownerPlan = owner?.plan || null
  }

  const state = resolveEffectiveEventAccessState({ billingTier: event.billingTier, ownerPlan })
  if (state.canDownloadGallery) {
    return { allowed: true, upgradePath: null }
  }

  return { allowed: false, upgradePath: 'pro_event' }
}
