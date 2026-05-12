import { NextResponse } from 'next/server'
import archiver from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkGalleryDownloadEntitlement, checkPhotoDownloadEntitlement } from '@/lib/server/entitlements'
import { getPhotoBuffer, applyWatermark, getDownloadFileName } from '@/lib/server/download-utils'

export const dynamic = 'force-dynamic'

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

    if (photos.length === 0) {
      return NextResponse.json({ error: 'No photos available for download' }, { status: 404 })
    }

    // Set up streaming ZIP response
    const archive = archiver('zip', { zlib: { level: 6 } })
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

    // Process photos one by one to keep memory low
    ;(async () => {
      try {
        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i]
          try {
            const buffer = await getPhotoBuffer(photo.url)
            const fileName = getDownloadFileName(photo)

            if (branded) {
              const watermarked = await applyWatermark(buffer)
              archive.append(watermarked, { name: fileName })
            } else {
              archive.append(buffer, { name: fileName })
            }
          } catch (photoError) {
            console.error(`${logPrefix} Failed to process photo ${photo.id}:`, photoError.message)
            // Skip failed photos, continue with the rest
          }
        }

        await archive.finalize()
      } catch (archiveError) {
        console.error(`${logPrefix} Archive error:`, archiveError)
        archive.abort()
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
