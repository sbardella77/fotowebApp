import { OWNER_WATERMARK_ACCESS_SELECT, resolveActiveWatermark } from '@/lib/server/photographer-watermark-config'
import { ensurePhotoWatermarkDisplay } from '@/lib/server/photographer-watermark-derivative'

/**
 * Regeneration of photographer-watermark display derivatives after a
 * settings change (OwnerWatermark.regenState = 'PENDING').
 *
 * Works the newest photos first, within a time budget, so recently shared
 * galleries converge first. Until a photo is done, guests still only ever
 * see it watermarked: guest-photo-url.js routes it through the lazy media
 * route. When an owner has nothing left to render, regenState goes IDLE.
 *
 * Pure function of injected dependencies, in the display-backfill.js style.
 */

export const REGEN_DEFAULT_BUDGET_MS = 240_000
export const REGEN_DEFAULT_CONCURRENCY = 2
export const REGEN_DEFAULT_MAX_PHOTOS = 1500
const PAGE_SIZE = 50

/**
 * @param {object} params
 * @param {object} params.prisma
 * @param {() => number} [params.now]
 * @param {number} [params.budgetMs]
 * @param {number} [params.concurrency]
 * @param {number} [params.maxPhotos]
 * @param {typeof ensurePhotoWatermarkDisplay} [params.ensure]
 * @returns {Promise<{owners: number, ownersCompleted: number, ownersSkipped: number, processed: number, failed: number, budgetExhausted: boolean}>}
 */
export async function runWatermarkRegeneration({
  prisma,
  now = Date.now,
  budgetMs = REGEN_DEFAULT_BUDGET_MS,
  concurrency = REGEN_DEFAULT_CONCURRENCY,
  maxPhotos = REGEN_DEFAULT_MAX_PHOTOS,
  ensure = ensurePhotoWatermarkDisplay,
}) {
  const deadline = now() + budgetMs
  const stats = { owners: 0, ownersCompleted: 0, ownersSkipped: 0, processed: 0, failed: 0, budgetExhausted: false }

  const pending = await prisma.ownerWatermark.findMany({
    where: { regenState: 'PENDING' },
    orderBy: { regenRequestedAt: 'asc' },
    select: { ownerId: true, owner: { select: OWNER_WATERMARK_ACCESS_SELECT } },
  })

  for (const { ownerId, owner } of pending) {
    stats.owners += 1
    const spec = resolveActiveWatermark(owner)
    if (!spec) {
      // Disabled, lapsed or incomplete: nothing to render. It is queued
      // again by the next save that enables it.
      await prisma.ownerWatermark.updateMany({ where: { ownerId }, data: { regenState: 'IDLE' } })
      stats.ownersSkipped += 1
      continue
    }

    // Photos that failed in this run are excluded from later pages, so one
    // broken source cannot spin the loop; the next run retries them.
    const failedIds = []
    let ownerDone = false
    while (!ownerDone) {
      if (now() >= deadline || stats.processed + stats.failed >= maxPhotos) {
        stats.budgetExhausted = true
        return stats
      }
      const photos = await prisma.photo.findMany({
        where: {
          event: { ownerId },
          status: 'VISIBLE',
          mediaType: 'IMAGE',
          displayDerivativeStatus: 'READY',
          OR: [{ watermarkDisplayRevision: null }, { watermarkDisplayRevision: { not: spec.revision } }],
          ...(failedIds.length ? { id: { notIn: failedIds } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: PAGE_SIZE,
        select: { id: true, url: true, mediaType: true },
      })
      if (photos.length === 0) {
        ownerDone = true
        break
      }

      for (let i = 0; i < photos.length; i += concurrency) {
        if (now() >= deadline || stats.processed + stats.failed >= maxPhotos) {
          stats.budgetExhausted = true
          return stats
        }
        const batch = photos.slice(i, i + concurrency)
        const results = await Promise.all(batch.map((photo) => ensure({ prisma, photo, spec, operation: 'watermarkRegeneration' })))
        results.forEach((result, index) => {
          if (result.ok) {
            stats.processed += 1
          } else {
            stats.failed += 1
            failedIds.push(batch[index].id)
          }
        })
      }
    }

    // Only IDLE when nothing failed: a failed photo keeps the owner PENDING
    // so the next run retries it. Guarded on the revision, so a settings
    // change saved during this run (new revision, PENDING again) is kept.
    if (failedIds.length === 0) {
      await prisma.ownerWatermark.updateMany({
        where: { ownerId, revision: spec.revision },
        data: { regenState: 'IDLE', regenCompletedAt: new Date(now()) },
      })
      stats.ownersCompleted += 1
    }
  }

  return stats
}
