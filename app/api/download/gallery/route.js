import { NextResponse } from 'next/server'
import { ZipArchive } from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkGalleryDownloadEntitlement, checkPhotoDownloadEntitlement } from '@/lib/server/entitlements'
import { getPhotoBuffer, applyWatermark, getDownloadFileName } from '@/lib/server/download-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/download/gallery?eventSlug={slug}
 *
 * Streams a ZIP archive of all visible photos for an event.
 * - Free events: blocked (403)
 * - Paid events: includes all visible photos, unbranded
 */
export async function GET(request) {
  const logPrefix = '[download/gallery]'
  try {
    const { searchParams } = new URL(request.url)
    const eventSlug = searchParams.get('eventSlug')

    if (!eventSlug || typeof eventSlug !== 'string') {
      return NextResponse.json({ error: 'eventSlug is required' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error(`${logPrefix} Database unavailable`)
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Load event
    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: {
        id: true,
        slug: true,
        name: true,
        billingTier: true,
        ownerId: true,
      },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Check gallery download entitlement
    const galleryEntitlement = await checkGalleryDownloadEntitlement(prisma, event)
    if (!galleryEntitlement.allowed) {
      return NextResponse.json(
        { error: 'Gallery download is not available for this event. Upgrade to download the full gallery.' },
        { status: 403 }
      )
    }

    // Check if individual photos should be branded
    const photoEntitlement = await checkPhotoDownloadEntitlement(prisma, event)
    const branded = photoEntitlement.branded

    // Fetch all visible photos for this event
    const photos = await prisma.photo.findMany({
      where: {
        eventId: event.id,
        status: 'VISIBLE',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        url: true,
      },
    })

    const MAX_GALLERY_PHOTOS = 200
    const totalEligible = photos.length
    const effectivePhotos = photos.slice(0, MAX_GALLERY_PHOTOS)
    const skippedCount = totalEligible - effectivePhotos.length

    console.log(`${logPrefix} event=${event.slug} branded=${branded} billingTier=${event.billingTier} totalEligible=${totalEligible} effective=${effectivePhotos.length} skipped=${skippedCount}`)

    if (photos.length === 0) {
      return NextResponse.json({ error: 'No photos available for download' }, { status: 404 })
    }

    // Set up streaming ZIP response
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const safeEventName = (event.name || event.slug)
      .replace(/[^a-zA-Z0-9\-_\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50)
    const zipFileName = `${safeEventName}_gallery.zip`

    const stream = new ReadableStream({
      start(controller) {
        archive.on('data', (chunk) => controller.enqueue(chunk))
        archive.on('end', () => controller.close())
        archive.on('error', (err) => controller.error(err))
      },
    })

    const routeStart = Date.now()
    let processedCount = 0
    let failedCount = 0

    // Process photos one by one to keep memory low
    ;(async () => {
      try {
        for (let i = 0; i < effectivePhotos.length; i++) {
          const photo = effectivePhotos[i]
          try {
            const buffer = await getPhotoBuffer(photo.url)
            const fileName = getDownloadFileName(photo)

            if (branded) {
              const watermarked = await applyWatermark(buffer)
              archive.append(watermarked, { name: fileName })
            } else {
              archive.append(buffer, { name: fileName })
            }
            processedCount += 1
          } catch (photoError) {
            console.error(`${logPrefix} Failed to process photo ${photo.id}:`, photoError.message)
            failedCount += 1
            // Skip failed photos, continue with the rest
          }
        }

        await archive.finalize()
      } catch (archiveError) {
        console.error(`${logPrefix} Archive error:`, archiveError)
        archive.abort()
      } finally {
        const duration = Date.now() - routeStart
        console.log(`${logPrefix} finished event=${event.slug} processed=${processedCount} failed=${failedCount} skipped=${skippedCount} durationMs=${duration}`)
      }
    })()

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(zipFileName)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error)
    return NextResponse.json(
      { error: 'Unable to generate gallery download. Please try again later.' },
      { status: 500 }
    )
  }
}
