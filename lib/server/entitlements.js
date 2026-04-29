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

const FREE_ROOM_LIMIT = 1
const FREE_PHOTO_LIMIT = 50

/**
 * Check if an owner can create more rooms.
 * Returns { allowed: boolean, current: number, max: number, upgradePath: string|null }
 */
export async function checkOwnerRoomCreationEntitlement(prisma, owner) {
  if (!prisma || !owner) {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Account-level premium: unlimited rooms
  if (owner.plan === 'professional' || owner.plan === 'business') {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Count active rooms for this owner
  const where = {
    OR: [
      { ownerId: owner.id },
      { ownerEmail: { equals: owner.email, mode: 'insensitive' } },
    ],
  }

  const current = await prisma.event.count({ where })

  if (current >= FREE_ROOM_LIMIT) {
    return {
      allowed: false,
      current,
      max: FREE_ROOM_LIMIT,
      upgradePath: 'professional',
    }
  }

  return { allowed: true, current, max: FREE_ROOM_LIMIT, upgradePath: null }
}

/**
 * Check if a room can accept more photo uploads.
 * Returns { allowed: boolean, current: number, max: number, upgradePath: string|null }
 */
export async function checkRoomUploadEntitlement(prisma, event) {
  if (!prisma || !event) {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Event-level premium tier: unlimited photos
  if (event.billingTier === 'pro_event' || event.billingTier === 'wedding_pro') {
    return { allowed: true, current: 0, max: Infinity, upgradePath: null }
  }

  // Account-level premium owner: unlimited photos
  if (event.ownerId) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    if (owner?.plan === 'professional' || owner?.plan === 'business') {
      return { allowed: true, current: 0, max: Infinity, upgradePath: null }
    }
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
