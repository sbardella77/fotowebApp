import { getPrismaClient } from '@/lib/server/prisma-client'
import { deleteStoredFile } from '@/lib/server/storage'
import { recoverStaleGalleryDownloadJobs } from '@/lib/server/gallery-download-job'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Clean up old gallery download jobs and their associated Blob storage.
 *
 * Retention policy:
 * - READY jobs with processedAt older than 7 days: delete Blob + delete record
 * - FAILED jobs with createdAt older than 30 days: delete record (no Blob)
 * - PENDING jobs older than 7 days: mark as FAILED (will be deleted later by FAILED rule)
 *
 * Errors on individual jobs are caught and logged; cleanup continues.
 */
export async function cleanupGalleryDownloads() {
  const prisma = await getPrismaClient()
  if (!prisma) {
    throw new Error('Database unavailable')
  }

  // 0. Recover stale PROCESSING jobs before cleanup
  const recoveryStats = await recoverStaleGalleryDownloadJobs()

  const now = Date.now()
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS)
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)

  // 1. Mark very old PENDING jobs as FAILED (they likely timed out)
  const pendingUpdateResult = await prisma.galleryDownloadJob.updateMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: sevenDaysAgo },
    },
    data: {
      status: 'FAILED',
      error: 'Timed out — marked failed by cleanup',
      processedAt: new Date(),
    },
  })

  // 2. Delete FAILED jobs older than 30 days
  const failedJobs = await prisma.galleryDownloadJob.findMany({
    where: {
      status: 'FAILED',
      createdAt: { lt: thirtyDaysAgo },
    },
    select: { id: true },
  })

  let deletedFailed = 0
  for (const job of failedJobs) {
    try {
      await prisma.galleryDownloadJob.delete({ where: { id: job.id } })
      deletedFailed += 1
    } catch (err) {
      console.error(`[cleanup] failed to delete FAILED job ${job.id}:`, err.message)
    }
  }

  // 3. Delete READY jobs older than 7 days (Blob + record)
  const readyJobs = await prisma.galleryDownloadJob.findMany({
    where: {
      status: 'READY',
      processedAt: { lt: sevenDaysAgo },
    },
    select: { id: true, resultUrl: true, eventId: true, processedAt: true },
  })

  let deletedBlobs = 0
  let deletedReady = 0
  let blobErrors = 0

  for (const job of readyJobs) {
    try {
      if (job.resultUrl) {
        await deleteStoredFile(job.resultUrl)
        deletedBlobs += 1
      }
      await prisma.galleryDownloadJob.delete({ where: { id: job.id } })
      deletedReady += 1
    } catch (err) {
      console.error(`[cleanup] failed for READY job ${job.id}:`, err.message)
      blobErrors += 1
    }
  }

  const stats = {
    ...recoveryStats,
    pendingMarkedFailed: pendingUpdateResult.count,
    failedDeleted: deletedFailed,
    failedCandidates: failedJobs.length,
    readyDeleted: deletedReady,
    readyCandidates: readyJobs.length,
    blobsDeleted: deletedBlobs,
    blobErrors,
  }

  console.log('[cleanup] stats:', JSON.stringify(stats))
  return stats
}
