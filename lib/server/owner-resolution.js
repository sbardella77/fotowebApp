/**
 * Canonical owner resolution for SnapRooms.
 *
 * Problem: PostgreSQL's unique index on Owner.email is case-sensitive.
 * This means 'A@B.COM' and 'a@b.com' are treated as distinct values.
 * Over time this can lead to multiple Owner rows for the same logical
 * email, causing rooms to be invisible and entitlement checks to fail.
 *
 * Strategy:
 * 1. Always normalize the lookup email (lower + trim).
 * 2. Query with findMany against the normalized email (exact match).
 *    Because Prisma's @unique is case-sensitive at the DB level, a
 *    lower-cased findUnique would miss a mixed-case row.  We instead
 *    query all owners whose email, when lower-cased, matches.
 * 3. If multiple rows exist, select the canonical one:
 *    a) Prefer plan in ('professional', 'business', 'pro')
 *    b) Then prefer the one linked to the most Events
 *    c) Then prefer the oldest createdAt record
 * 4. Return the canonical owner (or null if none found).
 *
 * This module also exposes a repair function that re-links Events
 * attached to non-canonical owners onto the canonical owner.
 */

import { getPrismaClient } from './prisma-client'

const PREMIUM_PLANS = new Set(['professional', 'business', 'pro'])

function isPremium(plan) {
  return PREMIUM_PLANS.has(plan)
}

/**
 * Resolve the canonical Owner record for a given email.
 *
 * @param {string} email
 * @returns {Promise<object|null>} canonical owner or null
 */
export async function resolveCanonicalOwner(email) {
  const prisma = await getPrismaClient()
  if (!prisma || !email) return null

  const normalized = email.toLowerCase().trim()

  // Use findMany so we catch any row whose raw email matches the normalized
  // form.  Because the DB index is case-sensitive, a mixed-case row would
  // be invisible to findUnique on the lower-cased value.
  const candidates = await prisma.owner.findMany({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: {
        select: { events: true },
      },
    },
  })

  if (candidates.length === 0) {
    return null
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  // Canonical selection:
  // 1. Prefer premium plan
  // 2. Then prefer most linked events
  // 3. Then oldest createdAt (stable tie-breaker)
  const canonical = candidates.reduce((best, current) => {
    const bestPremium = isPremium(best.plan)
    const currentPremium = isPremium(current.plan)

    if (currentPremium && !bestPremium) return current
    if (bestPremium && !currentPremium) return best

    const bestEvents = best._count?.events ?? 0
    const currentEvents = current._count?.events ?? 0
    if (currentEvents !== bestEvents) {
      return currentEvents > bestEvents ? current : best
    }

    return new Date(best.createdAt) <= new Date(current.createdAt) ? best : current
  })

  console.warn(
    `[resolveCanonicalOwner] Resolved ${candidates.length} duplicate owner rows for "${normalized}" ` +
      `→ chose id=${canonical.id} (plan=${canonical.plan}, events=${canonical._count?.events ?? 0}). ` +
      `Non-canonical ids: ${candidates.filter((c) => c.id !== canonical.id).map((c) => c.id).join(', ')}`
  )

  return canonical
}

/**
 * Get or create the canonical owner for an email.
 * If duplicates exist, returns the canonical one without creating a new row.
 */
export async function getOrCreateCanonicalOwner(email) {
  const prisma = await getPrismaClient()
  if (!prisma || !email) return null

  const canonical = await resolveCanonicalOwner(email)
  if (canonical) return canonical

  const normalized = email.toLowerCase().trim()
  try {
    return await prisma.owner.create({
      data: { email: normalized },
    })
  } catch (error) {
    // Race-condition safety: another request may have just created it.
    if (error?.code === 'P2002') {
      return resolveCanonicalOwner(email)
    }
    throw error
  }
}

/**
 * Find an owner by email, checking password match against ALL duplicate
 * owners if necessary.  This ensures login works even when the password
 * was set on a non-canonical duplicate row.
 *
 * @param {string} email
 * @param {(owner) => boolean} verifyFn — e.g. verifyPassword callback
 * @returns {Promise<object|null>} matching owner or null
 */
export async function findOwnerByEmailWithPassword(email, verifyFn) {
  const prisma = await getPrismaClient()
  if (!prisma || !email || typeof verifyFn !== 'function') return null

  const normalized = email.toLowerCase().trim()

  // First try the canonical owner (fast path)
  const canonical = await resolveCanonicalOwner(email)
  if (canonical && canonical.passwordHash && verifyFn(canonical)) {
    return canonical
  }

  // If canonical didn't match, scan all owners with this normalized email
  const candidates = await prisma.owner.findMany({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const candidate of candidates) {
    if (candidate.passwordHash && verifyFn(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Repair events that are linked to non-canonical owners.
 *
 * For every set of duplicate owners (same normalized email):
 * - pick canonical owner
 * - reassign all Events whose ownerId points to a non-canonical owner
 * - leave ownerEmail intact
 *
 * Returns a summary object for observability.
 */
export async function repairDuplicateOwnerAssignments() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    console.log('[repairDuplicateOwnerAssignments] No Prisma client — skipping.')
    return { duplicateGroups: 0, eventsReassigned: 0 }
  }

  try {
    // Find all owners and group by normalized email in memory.
    // In a large table this could be slow; we cap at 2000 owners.
    const owners = await prisma.owner.findMany({
      select: { id: true, email: true, plan: true, createdAt: true },
      take: 2000,
      orderBy: { createdAt: 'asc' },
    })

    const groups = new Map()
    for (const owner of owners) {
      const normalized = owner.email.toLowerCase().trim()
      if (!groups.has(normalized)) {
        groups.set(normalized, [])
      }
      groups.get(normalized).push(owner)
    }

    const duplicates = Array.from(groups.entries()).filter(([, list]) => list.length > 1)

    if (duplicates.length === 0) {
      console.log('[repairDuplicateOwnerAssignments] No duplicate owner emails found.')
      return { duplicateGroups: 0, eventsReassigned: 0 }
    }

    let totalReassigned = 0

    for (const [normalizedEmail, candidateOwners] of duplicates) {
      // Load event counts for canonical selection
      const ownersWithCounts = await prisma.owner.findMany({
        where: { id: { in: candidateOwners.map((o) => o.id) } },
        include: { _count: { select: { events: true } } },
        orderBy: { createdAt: 'asc' },
      })

      const canonical = ownersWithCounts.reduce((best, current) => {
        const bestPremium = isPremium(best.plan)
        const currentPremium = isPremium(current.plan)
        if (currentPremium && !bestPremium) return current
        if (bestPremium && !currentPremium) return best
        const bestEvents = best._count?.events ?? 0
        const currentEvents = current._count?.events ?? 0
        return currentEvents >= bestEvents ? current : best
      })

      const nonCanonicals = ownersWithCounts.filter((o) => o.id !== canonical.id)
      const nonCanonicalIds = nonCanonicals.map((o) => o.id)

      if (nonCanonicalIds.length === 0) continue

      // If canonical owner lacks a password but a non-canonical has one,
      // copy it over so login continues to work.
      if (!canonical.passwordHash) {
        const donor = nonCanonicals.find((o) => o.passwordHash)
        if (donor) {
          await prisma.owner.update({
            where: { id: canonical.id },
            data: {
              passwordHash: donor.passwordHash,
              passwordSalt: donor.passwordSalt,
              updatedAt: new Date(),
            },
          })
          console.log(
            `[repairDuplicateOwnerAssignments] Copied password from owner ${donor.id} → canonical owner ${canonical.id}`
          )
        }
      }

      const updateResult = await prisma.event.updateMany({
        where: {
          ownerId: { in: nonCanonicalIds },
        },
        data: {
          ownerId: canonical.id,
          updatedAt: new Date(),
        },
      })

      totalReassigned += updateResult.count

      console.log(
        `[repairDuplicateOwnerAssignments] Email "${normalizedEmail}": ` +
          `reassigned ${updateResult.count} event(s) from non-canonical owners ` +
          `[${nonCanonicalIds.join(', ')}] → canonical owner ${canonical.id} ` +
          `(plan=${canonical.plan}).`
      )
    }

    console.log(
      `[repairDuplicateOwnerAssignments] Done. Found ${duplicates.length} duplicate group(s), ` +
        `reassigned ${totalReassigned} event(s) total.`
    )

    return { duplicateGroups: duplicates.length, eventsReassigned: totalReassigned }
  } catch (error) {
    console.error('[repairDuplicateOwnerAssignments] Repair failed:', error?.message ? String(error.message).replace(/\b\w+:\/\/[^\s]+/g, '[REDACTED]').substring(0, 200) : 'unknown')
    return { duplicateGroups: 0, eventsReassigned: 0, error: error?.message }
  }
}
