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
  const recentReady = await prisma.galleryDownloadJob.findFirst({
    where: { eventId, status: 'READY', createdAt: { gte: oneHourAgo } },
    orderBy: { createdAt: 'desc' },
  })
  if (recentReady) return recentReady
  const active = await prisma.galleryDownloadJob.findFirst({
    where: { eventId, status: { in: ['PENDING', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (active) return active
  return prisma.galleryDownloadJob.create({ data: { eventId, status: 'PENDING' } })
}

export async function getLatestGalleryDownloadJob(eventId) {
  const prisma = await getPrismaClient()
  if (!prisma) return null
  return prisma.galleryDownloadJob.findFirst({ where: { eventId }, orderBy: { createdAt: 'desc' } })
}

export async function processGalleryDownloadJobIfPending(jobId, event) {
  const prisma = await getPrismaClient()
  if (!prisma) throw new Error('Database unavailable')
  const job = await prisma.galleryDownloadJob.findUnique({ where: { id: jobId } })
  if (!job) return null

  if (job.attempts >= MAX_ATTEMPTS) {
    return prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: 'Maximum processing attempts reached. Please try again later.' },
    })
  }

  const totalCount = await prisma.photo.count({ where: { eventId: event.id, status: 'VISIBLE' } })
  if (totalCount > MAX_ASYNC_GALLERY_PHOTOS) {
    return prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: `Gallery too large for immediate export (${totalCount} photos). Maximum supported: ${MAX_ASYNC_GALLERY_PHOTOS}.` },
    })
  }

  const lockResult = await prisma.galleryDownloadJob.updateMany({
    where: { id: jobId, status: 'PENDING' },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date(), processedAt: new Date() },
  })
  if (lockResult.count === 0) return getLatestGalleryDownloadJob(event.id)

  const attemptNumber = job.attempts + 1
  const tmpPath = path.join(TMP_DIR, `gallery-${jobId}.zip`)
  const start = Date.now()

  try {
    await mkdir(TMP_DIR, { recursive: true })
    const access = await getEffectiveEventAccessState(prisma, event)
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const output = createWriteStream(tmpPath)
    let streamError = null
    output.on('error', (err) => { streamError = err })
    archive.on('error', (err) => { streamError = err })
    archive.pipe(output)

    let processed = 0
    let failed = 0
    let skip = 0
    while (skip < totalCount) {
      const photos = await prisma.photo.findMany({
        where: { eventId: event.id, status: 'VISIBLE' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip,
        select: { id: true, originalName: true, storedName: true, mimeType: true, url: true },
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
        } catch {
          console.error(`[gallery-job] job=${jobId} failed photo ${photo.id}`)
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
    console.log(`[gallery-job] job=${jobId} event=${event.slug} quality=standard attempt=${attemptNumber} processed=${processed} failed=${failed} total=${totalCount} durationMs=${Date.now() - start}`)
    return updatedJob
  } catch (error) {
    console.error(`[gallery-job] job=${jobId} event=${event.slug} attempt=${attemptNumber} failed durationMs=${Date.now() - start}`)
    await prisma.galleryDownloadJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: 'Gallery export failed. Please try again later.' },
    })
    throw error
  } finally {
    try { await rm(tmpPath, { force: true }) } catch { /* best effort */ }
  }
}

export async function recoverStaleGalleryDownloadJobs() {
  const prisma = await getPrismaClient()
  if (!prisma) throw new Error('Database unavailable')
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
  const staleJobs = await prisma.galleryDownloadJob.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: staleThreshold } },
    select: { id: true, eventId: true, attempts: true },
  })
  let recovered = 0
  let failed = 0
  for (const job of staleJobs) {
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await prisma.galleryDownloadJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', error: 'Processing timed out after maximum attempts.' },
        })
        failed += 1
      } else {
        await prisma.galleryDownloadJob.update({ where: { id: job.id }, data: { status: 'PENDING', error: null } })
        recovered += 1
      }
    } catch {
      console.error(`[gallery-job-recovery] job=${job.id} recovery failed`)
    }
  }
  return { staleJobs: staleJobs.length, recovered, failed }
}
