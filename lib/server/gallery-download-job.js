import { createWriteStream } from 'fs'
import { mkdir, rm, readFile } from 'fs/promises'
import path from 'path'
import { ZipArchive } from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getDownloadFileName } from '@/lib/server/download-utils'
import { resolveDownloadRepresentation } from '@/lib/server/download-representation'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'

const TMP_DIR = '/tmp'
const MAX_ATTEMPTS = 3
const MAX_ASYNC_GALLERY_PHOTOS = 1000
const STALE_MINUTES = 15

export async function createGalleryDownloadJob(eventId) {
  const prisma = await getPrismaClient()
  if (!prisma) throw new Error('Database unavailable')

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

  // Reuse a recent READY job
  const recentReady = await prisma.galleryDownloadJob.findFirst({
    where: {
      eventId,
      status: 'READY',
      createdAt: { gte: oneHourAgo },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (recentReady) return recentReady

  // Return existing pending/processing job
  const active = await prisma.galleryDownloadJob.findFirst({
    where: {
      eventId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (active) return active

  // Create new job
  return prisma.galleryDownloadJob.create({
    data: { eventId, status: 'PENDING' },
  })
}

export async function getLatestGalleryDownloadJob(eventId) {
  const prisma = await getPrismaClient()
  if (!prisma) return null
  return prisma.galleryDownloadJob.findFirst({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function processGalleryDownloadJobIfPending(jobId, event) {
  const prisma = await getPrismaClient()
  if (!prisma) throw new Error('Database unavailable')

  const job = await prisma.galleryDownloadJob.findUnique({ where: { id: jobId } })
  if (!job) {
    console.warn(`[gallery-job] job=${jobId} not found`)
    return null
  }

  // Max attempts guard
  if (job.attempts >= MAX_ATTEMPTS) {
    console.warn(`[gallery-job] job=${jobId} max attempts reached (${job.attempts}), marking FAILED`)
    return prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: 'Maximum processing attempts reached. Please try again later.',
      },
    })
  }

  // Soft cap guard: count photos before processing
  const totalCount = await prisma.photo.count({
    where: { eventId: event.id, status: 'VISIBLE' },
  })
  if (totalCount > MAX_ASYNC_GALLERY_PHOTOS) {
    console.warn(`[gallery-job] job=${jobId} event=${event.slug} too large (${totalCount} photos), marking FAILED`)
    return prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: `Gallery too large for immediate export (${totalCount} photos). Maximum supported: ${MAX_ASYNC_GALLERY_PHOTOS}.`,
      },
    })
  }

  // Atomically lock job: increment attempts, set PROCESSING
  const lockResult = await prisma.galleryDownloadJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: {
      status: 'PROCESSING',
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      processedAt: new Date(),
    },
  })

  if (lockResult.count === 0) {
    console.log(`[gallery-job] job=${jobId} already picked up by another instance`)
    return getLatestGalleryDownloadJob(event.id)
  }

  const attemptNumber = job.attempts + 1
  const tmpPath = path.join(TMP_DIR, `gallery-${jobId}.zip`)
  const start = Date.now()

  try {
    await mkdir(TMP_DIR, { recursive: true })

    const access = await getEffectiveEventAccessState(prisma, event)

    const archive = new ZipArchive({ zlib: { level: 6 } })
    const output = createWriteStream(tmpPath)

    // Do NOT wait for 'close' here: it only fires after archive.finalize().
    // Errors are captured and re-thrown after the post-finalize wait below.
    let streamError = null
    output.on('error', (err) => { streamError = err })
    archive.on('error', (err) => { streamError = err })
    archive.pipe(output)

    let processed = 0
    let failed = 0
    const batchSize = 50
    let skip = 0

    while (skip < totalCount) {
      const photos = await prisma.photo.findMany({
        where: { eventId: event.id, status: 'VISIBLE' },
        orderBy: { createdAt: 'desc' },
        take: batchSize,
        skip,
        select: {
          id: true,
          originalName: true,
          storedName: true,
          mimeType: true,
          url: true,
        },
      })

      if (photos.length === 0) break

      for (const photo of photos) {
        try {
          const representation = await resolveDownloadRepresentation({
            photo,
            requestedQuality: 'standard',
            access,
          })
          const fileName = getDownloadFileName(photo, { extension: representation.extension || undefined })
          archive.append(representation.buffer, { name: fileName })
          processed += 1
        } catch (photoError) {
          console.error(`[gallery-job] job=${jobId} failed photo ${photo.id}:`, photoError.message)
          failed += 1
        }
      }

      skip += photos.length
    }

    await archive.finalize()
    await new Promise((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
    })
    if (streamError) throw streamError

    const { put } = await import('@vercel/blob')
    const blobPathname = `gallery-downloads/${event.slug}/${jobId}.zip`
    const blob = await put(blobPathname, Buffer.from(await readFile(tmpPath)), {
      access: 'public',
      contentType: 'application/zip',
    })

    const updatedJob = await prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: { status: 'READY', resultUrl: blob.url },
    })

    const duration = Date.now() - start
    console.log(`[gallery-job] job=${jobId} event=${event.slug} attempt=${attemptNumber} processed=${processed} failed=${failed} total=${totalCount} durationMs=${duration} url=${blob.url}`)

    return updatedJob
  } catch (error) {
    const duration = Date.now() - start
    console.error(`[gallery-job] job=${jobId} event=${event.slug} attempt=${attemptNumber} failed durationMs=${duration}:`, error.message)
    await prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: error.message || 'Unknown error' },
    })
    throw error
  } finally {
    try {
      await rm(tmpPath, { force: true })
    } catch {
      // ignore cleanup errors
    }
  }
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
