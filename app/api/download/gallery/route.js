import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { ZipArchive } from 'archiver'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { getDownloadFileName } from '@/lib/server/download-utils'
import { resolveDownloadRepresentation } from '@/lib/server/download-representation'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { serializeProviderError } from '@/lib/server/safe-log'
import { buildZipVideoNote, selectZipVideos } from '@/lib/server/gallery-zip-videos'

export const dynamic = 'force-dynamic'
// Videos make archives far larger than photo-only ones (see
// lib/server/gallery-zip-videos.js for the size caps this budget covers).
export const maxDuration = 300

/**
 * GET /api/download/gallery?eventSlug={slug}
 *
 * Streams a ZIP archive of all visible photos and videos for an event.
 * - Free events: blocked (403)
 * - Paid events: includes all visible photos, unbranded, plus videos as
 *   Mux MP4 renditions (capped; a note in the ZIP lists any left out)
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
      RATE_LIMITS.galleryDownloadCreate.ip.window
    )
    if (rateLimitCheck.limited) {
      return NextResponse.json(
        { error: 'Too many download requests. Please try again later.', code: 'rate_limited', retryAfter: rateLimitCheck.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rateLimitCheck.retryAfter) } }
      )
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
    const access = await getEffectiveEventAccessState(prisma, event)
    if (!access.canDownloadGallery) {
      return NextResponse.json(
        { error: 'Gallery download is not available for this event. Upgrade to download the full gallery.' },
        { status: 403 }
      )
    }

    // Fetch all visible photos for this event
    const photos = await prisma.photo.findMany({
      where: {
        eventId: event.id,
        status: 'VISIBLE',
        mediaType: 'IMAGE',
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

    const videoRows = await prisma.photo.findMany({
      where: { eventId: event.id, status: 'VISIBLE', mediaType: 'VIDEO' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalName: true, storedName: true, size: true, videoStatus: true, muxPlaybackId: true },
    })
    const videoSelection = selectZipVideos(videoRows)
    const videoNote = buildZipVideoNote(videoSelection)

    console.log(`${logPrefix} event=${event.slug} branded=${!access.hasUnbrandedDownloads} billingTier=${event.billingTier} totalEligible=${totalEligible} effective=${effectivePhotos.length} skipped=${skippedCount} videos=${videoSelection.included.length} videosSkipped=${videoSelection.skipped.length} videosNotReady=${videoSelection.notReady.length}`)

    if (photos.length === 0 && videoSelection.included.length === 0) {
      return NextResponse.json({ error: 'No photos available for download' }, { status: 404 })
    }

    // Set up streaming ZIP response
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const safeEventName = (event.name || event.slug)
      .replace(/[^a-zA-Z0-9\-_\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50)
    const zipFileName = `${safeEventName}_gallery.zip`

    // Readable.toWeb propagates backpressure: the archive (and the Mux
    // video streams feeding it) only advance as fast as the browser reads,
    // so a multi-GB ZIP never buffers in function memory.
    const stream = Readable.toWeb(archive)

    const routeStart = Date.now()
    let processedCount = 0
    let failedCount = 0

    // Process photos one by one to keep memory low
    ;(async () => {
      try {
        for (let i = 0; i < effectivePhotos.length; i++) {
          const photo = effectivePhotos[i]
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
            console.error(`${logPrefix} Failed to process photo ${photo.id}:`, photoError.message)
            failedCount += 1
            // Skip failed photos, continue with the rest
          }
        }

        for (const video of videoSelection.included) {
          try {
            const response = await fetch(video.sourceUrl)
            if (!response.ok || !response.body) throw new Error(`Mux MP4 ${response.status}`)
            const entryDone = new Promise((resolve, reject) => {
              const onEntry = () => { archive.off('error', onError); resolve() }
              const onError = (err) => { archive.off('entry', onEntry); reject(err) }
              archive.once('entry', onEntry)
              archive.once('error', onError)
            })
            // Already-compressed video: store, don't deflate.
            archive.append(Readable.fromWeb(response.body), {
              name: `videos/${getDownloadFileName(video, { extension: '.mp4' })}`,
              store: true,
            })
            await entryDone
            processedCount += 1
          } catch (videoError) {
            console.error(`${logPrefix} Failed to add video ${video.id}:`, videoError.message)
            failedCount += 1
          }
        }

        if (videoNote) archive.append(videoNote, { name: 'videos/README.txt' })

        await archive.finalize()
      } catch (archiveError) {
        console.error(`${logPrefix} Archive error:`, serializeProviderError('archiver', 'gallery_zip', archiveError))
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
