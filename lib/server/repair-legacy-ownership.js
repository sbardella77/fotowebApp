/**
 * Safe runtime repair for legacy Event ownership.
 *
 * Problem: rooms created before the Owner model existed may have
 * ownerEmail set but ownerId left null. After the Owner table was
 * introduced, dashboard queries started joining on ownerId, so
 * legacy rooms disappeared for their owners.
 *
 * This utility backfills Event.ownerId where:
 *   - Event.ownerId IS NULL
 *   - Event.ownerEmail IS NOT NULL
 *   - an Owner record exists with a matching email (trimmed + lowercased)
 *
 * It is idempotent and safe to run on every startup.
 */

import { getPrismaClient } from './prisma-client'

let repairAttempted = false

export async function repairLegacyOwnership() {
  if (repairAttempted) return
  repairAttempted = true

  const prisma = await getPrismaClient()
  if (!prisma) {
    console.log('[repairLegacyOwnership] No Prisma client available — skipping.')
    return
  }

  try {
    // Find all events that are missing ownerId but have an ownerEmail
    const events = await prisma.event.findMany({
      where: {
        ownerId: null,
        ownerEmail: { not: null },
      },
      select: {
        id: true,
        ownerEmail: true,
      },
      take: 500,
    })

    if (events.length === 0) {
      console.log('[repairLegacyOwnership] No legacy events need repair.')
      return
    }

    // Group by normalized email so we can look owners up efficiently
    const emailToEventIds = new Map()
    for (const event of events) {
      const normalized = event.ownerEmail.toLowerCase().trim()
      if (!emailToEventIds.has(normalized)) {
        emailToEventIds.set(normalized, [])
      }
      emailToEventIds.get(normalized).push(event.id)
    }

    const normalizedEmails = Array.from(emailToEventIds.keys())

    // Look up owners by normalized email
    const owners = await prisma.owner.findMany({
      where: {
        email: { in: normalizedEmails },
      },
      select: {
        id: true,
        email: true,
      },
    })

    let repairedCount = 0
    for (const owner of owners) {
      const normalizedOwnerEmail = owner.email.toLowerCase().trim()
      const eventIds = emailToEventIds.get(normalizedOwnerEmail)
      if (!eventIds || eventIds.length === 0) continue

      const updateResult = await prisma.event.updateMany({
        where: {
          id: { in: eventIds },
          ownerId: null,
        },
        data: {
          ownerId: owner.id,
          updatedAt: new Date(),
        },
      })

      repairedCount += updateResult.count
    }

    const unmatchedCount = events.length - repairedCount
    console.log(
      `[repairLegacyOwnership] Repaired ${repairedCount} legacy event(s). ${unmatchedCount} event(s) still unmatched (no Owner record found).`
    )
  } catch (error) {
    console.error('[repairLegacyOwnership] Repair failed:', error?.message || error)
  }
}
