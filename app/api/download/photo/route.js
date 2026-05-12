import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkPhotoDownloadEntitlement } from '@/lib/server/entitlements'
import { processPhotoForDownload, getDownloadFileName } from '@/lib/server/download-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/download/photo?photoUrl={url}&eventSlug={slug}&type={standard|original}
 *
 * Serves a single photo download. Applies watermark for Free events.
 * Originals are served as-is (no processing) when requested.
 */
export async function GET(request) {
  const logPrefix = '[download/photo]'
  try {
    const { searchParams } = new URL(request.url)
    const photoUrl = searchParams.get('photoUrl')
    const eventSlug = searchParams.get('eventSlug')
    const type = searchParams.get('type') || 'standard'

    if (!photoUrl || typeof photoUrl !== 'string') {
      return NextResponse.json({ error: 'photoUrl is required' }, { status: 400 })
    }

    if (!eventSlug || typeof eventSlug !== 'string') {
      return NextResponse.json({ error: 'eventSlug is required' }, { status: 400 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error(`${logPrefix} Database unavailable`)
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Load event to check entitlement
    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: {
        id: true,
        slug: true,
        billingTier: true,
        ownerId: true,
      },
    })

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    // Find the photo belonging to this event
    const photo = await prisma.photo.findFirst({
      where: {
        eventId: event.id,
        url: photoUrl,
        status: 'VISIBLE',
      },
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        url: true,
      },
    })

    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Check entitlement
    const entitlement = await checkPhotoDownloadEntitlement(prisma, event)
    const branded = entitlement.branded

    // For original downloads, skip watermarking entirely
    if (type === 'original') {
      const { buffer } = await processPhotoForDownload({
        photoUrl: photo.url,
        branded: false,
      })

      const fileName = getDownloadFileName(photo)
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': photo.mimeType || 'image/jpeg',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
          'Cache-Control': 'private, max-age=300',
        },
      })
    }

    // Standard download: apply watermark if Free
    const { buffer } = await processPhotoForDownload({
      photoUrl: photo.url,
      branded,
    })

    const suffix = branded ? '' : ''
    const fileName = getDownloadFileName(photo, { suffix })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': photo.mimeType || 'image/jpeg',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error)
    return NextResponse.json(
      { error: 'Unable to process download. Please try again later.' },
      { status: 500 }
    )
  }
}
