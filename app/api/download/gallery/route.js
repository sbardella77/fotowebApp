import { NextResponse } from 'next/server'
import { ZipArchive } from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { getDownloadFileName } from '@/lib/server/download-utils'
import { resolveDownloadRepresentation } from '@/lib/server/download-representation'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { serializeProviderError } from '@/lib/server/safe-log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/download/gallery?eventSlug={slug}
 * Gallery exports intentionally use the STANDARD representation contract.
 * A future Original-gallery UI must request original explicitly and satisfy
 * the same server-side entitlement resolver used by single-photo downloads.
 */
export async function GET(request) {
  const logPrefix = '[download/gallery]'
  try {
    const { searchParams } = new URL(request.url)
    const eventSlug = searchParams.get('eventSlug')
    if (!eventSlug || typeof eventSlug !== 'string') {
      return NextResponse.json({ error: 'eventSlug is required' }, { status: 400 })
    }

    const clientIp = getClientIp(request)
    const rateLimitCheck = await checkRateLimit(
      `gallery-download:create:ip:${hashIdentifier(clientIp)}:event:${eventSlug}`,
      RATE_LIMITS.galleryDownloadCreate.ip.max,
      RATE_LIMITS.galleryDownloadCreate.ip.window,
    )
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        { error: 'Too many download requests. Please try again later.', code: 'rate_limited', retryAfter: rateLimitCheck.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rateLimitCheck.retryAfter) } },
      )
    }

    const prisma = await getPrismaClient()
    if (!prisma) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })

    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: { id: true, slug: true, name: true, billingTier: true, originalDownloadUnlocked: true, ownerId: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.canDownloadGallery) {
      return NextResponse.json({ error: 'Gallery download is not available for this event. Upgrade to download the full gallery.' }, { status: 403 })
    }

    const photos = await prisma.photo.findMany({
      where: { eventId: event.id, status: 'VISIBLE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true, storedName: true, mimeType: true, url: true },
    })
    if (photos.length === 0) return NextResponse.json({ error: 'No photos available for download' }, { status: 404 })

    const MAX_GALLERY_PHOTOS = 200
    const effectivePhotos = photos.slice(0, MAX_GALLERY_PHOTOS)
    const skippedCount = photos.length - effectivePhotos.length
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const safeEventName = (event.name || event.slug).replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '_').substring(0, 50)
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
    ;(async () => {
      try {
        for (const photo of effectivePhotos) {
          try {
            const representation = await resolveDownloadRepresentation({
              photo,
              requestedQuality: 'standard',
              access,
            })
            const fileName = getDownloadFileName(photo, { extension: representation.extension || undefined })
            archive.append(representation.buffer, { name: fileName })
            processedCount += 1
          } catch (photoError) {
            console.error(`${logPrefix} Failed to process photo ${photo.id}`)
            failedCount += 1
          }
        }
        await archive.finalize()
      } catch (archiveError) {
        console.error(`${logPrefix} Archive error:`, serializeProviderError('archiver', 'gallery_zip', archiveError))
        archive.abort()
      } finally {
        console.log(`${logPrefix} finished event=${event.slug} quality=standard processed=${processedCount} failed=${failedCount} skipped=${skippedCount} durationMs=${Date.now() - routeStart}`)
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
  } catch {
    console.error(`${logPrefix} Unexpected gallery download failure`)
    return NextResponse.json({ error: 'Unable to generate gallery download. Please try again later.' }, { status: 500 })
  }
}
