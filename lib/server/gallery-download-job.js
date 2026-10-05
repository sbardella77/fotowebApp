import { getPrismaClient } from '@/lib/server/prisma-client'

/**
 * Async Gallery ZIP export — DISABLED (P0 Gallery ZIP exposure closure).
 *
 * The previous async flow rendered the gallery into a ZIP and stored it as
 * a PUBLIC Vercel Blob whose permanent URL was persisted in
 * GalleryDownloadJob.resultUrl, returned to any slug holder, redirected to
 * by jobId alone and written to logs. That generation path has been
 * removed entirely — there is no code left in this module that creates a
 * ZIP, touches Blob storage, or produces a delivery URL — until a private,
 * server-authorized export store exists (TARGET_PRIVATE_ZIP).
 *
 * What remains is read-only access for the status endpoint (always through
 * toClientGalleryDownloadJob) and the stale-job recovery used by the
 * cleanup cron, so existing rows are still aged out.
 */

const MAX_ATTEMPTS = 3
const STALE_MINUTES = 15

export const GALLERY_EXPORT_UNAVAILABLE_CODE = 'export_unavailable'

/**
 * The only client-visible shape of a GalleryDownloadJob. Allowlist, never
 * the raw row: resultUrl (a permanent public Blob URL on legacy rows),
 * eventId, error text and attempt bookkeeping never leave the server.
 */
export function toClientGalleryDownloadJob(job) {
  if (!job) return null
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
  }
}

export async function getLatestGalleryDownloadJob(eventId) {
  const prisma = await getPrismaClient()
  if (!prisma) return null
  return prisma.galleryDownloadJob.findFirst({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Recover stale PROCESSING jobs that have been stuck for too long.
 * Called by cleanup cron and optionally by polling route.
 */
export async function recoverStaleGalleryDownloadJobs() {
  const prisma = await getPrismaClient()
  if (!prisma) throw new Error('Database unavailable')

  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)

  const staleJobs = await prisma.galleryDownloadJob.findMany({
    where: {
      status: 'PROCESSING',
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, eventId: true, attempts: true },
  })

  let recovered = 0
  let failed = 0

  for (const job of staleJobs) {
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await prisma.galleryDownloadJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            error: 'Processing timed out after maximum attempts.',
          },
        })
        failed += 1
        console.warn(`[gallery-job-recovery] job=${job.id} stale, max attempts reached, marked FAILED`)
      } else {
        await prisma.galleryDownloadJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            error: null,
          },
        })
        recovered += 1
        console.log(`[gallery-job-recovery] job=${job.id} stale, attempt ${job.attempts}/${MAX_ATTEMPTS}, returned to PENDING`)
      }
    } catch (err) {
      console.error(`[gallery-job-recovery] job=${job.id} recovery failed:`, err.message)
    }
  }

  return { staleJobs: staleJobs.length, recovered, failed }
}
