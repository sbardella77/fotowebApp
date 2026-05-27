/**
 * Server-side effective event access state resolver.
 *
 * Wraps the isomorphic {@link resolveEffectiveEventAccessState} with
 * Prisma-aware owner lookup when `ownerPlan` is not already denormalised
 * onto the event object.
 */

import { resolveEffectiveEventAccessState } from '@/lib/event-access'

/**
 * Get the effective access state for an event, querying the owner plan
 * from Prisma only when necessary.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {Object} event — must contain at least `billingTier`, `originalDownloadUnlocked`, and either `ownerPlan` or `ownerId`
 * @returns {Promise<ReturnType<typeof resolveEffectiveEventAccessState>>}
 */
export async function getEffectiveEventAccessState(prisma, event) {
  if (!event) {
    // Defensive: return a fully-free state
    return resolveEffectiveEventAccessState({
      billingTier: null,
      originalDownloadUnlocked: false,
      ownerPlan: null,
    })
  }

  let ownerPlan = event.ownerPlan ?? null

  // Fallback to DB lookup when ownerPlan is not denormalised
  if (ownerPlan == null && event.ownerId && prisma) {
    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { plan: true },
    })
    ownerPlan = owner?.plan || null
  }

  return resolveEffectiveEventAccessState({
    billingTier: event.billingTier || null,
    originalDownloadUnlocked: !!event.originalDownloadUnlocked,
    ownerPlan,
  })
}
