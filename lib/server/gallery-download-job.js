import { createWriteStream } from 'fs'
import { mkdir, rm, readFile } from 'fs/promises'
import path from 'path'
import { ZipArchive } from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getPhotoBuffer, applyWatermark, getDownloadFileName } from '@/lib/server/download-utils'
import { checkGalleryDownloadEntitlement, checkPhotoDownloadEntitlement } from '@/lib/server/entitlements'

const TMP_DIR = '/tmp'

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

  try {
    await prisma.galleryDownloadJob.update({
      where: { id: jobId, status: 'PENDING' },
      data: { status: 'PROCESSING', processedAt: new Date() },
    })
  } catch (err) {
    // Another instance already picked up this job (P2025)
    return getLatestGalleryDownloadJob(event.id)
  }

  const tmpPath = path.join(TMP_DIR, `gallery-${jobId}.zip`)

  try {
    await mkdir(TMP_DIR, { recursive: true })

    const photoEntitlement = await checkPhotoDownloadEntitlement(prisma, event)
    const branded = photoEntitlement.branded

    const totalCount = await prisma.photo.count({
      where: { eventId: event.id, status: 'VISIBLE' },
    })

    const archive = new ZipArchive({ zlib: { level: 6 } })
    const output = createWriteStream(tmpPath)

    await new Promise((resolve, reject) => {
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
    })

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
          const buffer = await getPhotoBuffer(photo.url)
          const fileName = getDownloadFileName(photo)
          if (branded) {
            const watermarked = await applyWatermark(buffer)
            archive.append(watermarked, { name: fileName })
          } else {
            archive.append(buffer, { name: fileName })
          }
          processed += 1
        } catch (photoError) {
          console.error(`[gallery-job] Failed to process photo ${photo.id}:`, photoError.message)
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

    // Upload to Vercel Blob
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

    console.log(`[gallery-job] job=${jobId} event=${event.slug} processed=${processed} failed=${failed} total=${totalCount} url=${blob.url}`)

    return updatedJob
  } catch (error) {
    console.error(`[gallery-job] job=${jobId} failed:`, error)
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
