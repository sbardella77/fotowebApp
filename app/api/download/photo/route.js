import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { processPhotoForDownload, getDownloadFileName, getPhotoBuffer } from '@/lib/server/download-utils'
import {
  getBrandedDerivative,
  DerivativeStorageUnavailableError,
  DerivativePendingError,
} from '@/lib/server/download-derivative'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'

export const dynamic = 'force-dynamic'
// Explicit winner-lifetime bound. The derivative transform lock TTL (25s) is
// deliberately larger than this, so a normally-running invocation can never
// outlive its own lock and duplicate work while still healthy.
export const maxDuration = 20

// Branded downloads are transcoded to JPEG (see
// BRANDED_DOWNLOAD_WATERMARK_OPTIONS), so the response contract must
// advertise JPEG rather than the source format.
const BRANDED_CONTENT_TYPE = 'image/jpeg'
const BRANDED_EXTENSION = '.jpg'

/**
 * GET /api/download/photo?photoId={id}&type={standard|original}
 *
 * Serves a single photo download. Applies watermark for Free events.
 * Originals are served as-is (no processing) when requested.
 *
 * TASK-03 (Phase 1A): the contract now keys off the opaque Photo id
 * instead of the original Blob URL + event slug. This is a prerequisite
 * for the eventual guest DTO cutover (the public DTO cannot keep handing
 * out the original URL just so this one endpoint has something to key
 * off — the id is already present in the DTO regardless of what `url`
 * ends up meaning). `type`, like before, is accepted for observability
 * only and never decides branded vs. unbranded — that stays entirely
 * server-side, from the event's own entitlement state.
 */
export async function GET(request) {
  const logPrefix = '[download/photo]'
  const start = Date.now()
  try {
    const { searchParams } = new URL(request.url)
    const photoId = searchParams.get('photoId')
    const type = searchParams.get('type') || 'standard'

    if (!photoId || typeof photoId !== 'string') {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    // Broad, Redis-backed, hashed-IP guard. Runs before ANY database work so
    // invalid-slug / invalid-photo-id floods never reach Prisma, Blob, or
    // Sharp. Fails open to the in-memory bucket — a Redis outage must not
    // break public photo downloads.
    const clientIp = getClientIp(request)
    const broadLimit = await checkRateLimit(
      `download-photo-broad:ip:${hashIdentifier(clientIp)}`,
      RATE_LIMITS.downloadPhotoBroad.ip.max,
      RATE_LIMITS.downloadPhotoBroad.ip.window,
    )
    if (broadLimit.limited) {
      return NextResponse.json(
        { error: 'Too many download requests. Please try again later.' },
        { status: 429 }
      )
    }

    const prisma = await getPrismaClient()
    if (!prisma) {
      console.error(`${logPrefix} Database unavailable`)
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
    }

    // Single lookup by the opaque id. status: 'VISIBLE' is enforced here,
    // not as a separate check, so a HIDDEN or nonexistent photoId produces
    // the identical 404 below — never distinguishable from the outside.
    const photo = await prisma.photo.findFirst({
      where: {
        id: photoId,
        status: 'VISIBLE',
      },
      select: {
        id: true,
        eventId: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        url: true,
      },
    })

    if (!photo) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Event is derived from the photo's own eventId — never trusted from
    // the client. eventSlug is no longer part of the request contract.
    const event = await prisma.event.findUnique({
      where: { id: photo.eventId },
      select: {
        id: true,
        slug: true,
        billingTier: true,
        originalDownloadUnlocked: true,
        ownerId: true,
      },
    })

    if (!event) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
    }

    // Check entitlement
    const access = await getEffectiveEventAccessState(prisma, event)
    const branded = !access.hasUnbrandedDownloads

    console.log(`${logPrefix} event=${event.slug} type=${type} branded=${branded} billingTier=${event.billingTier} unlock=${event.originalDownloadUnlocked}`)

    // Branded downloads are served from a deterministic, version-scoped Blob
    // derivative produced at most once per photo (STEP 7.14b); unbranded
    // output stays an untouched passthrough of the source.
    let buffer
    if (branded) {
      buffer = await getBrandedDerivative({
        photoId: photo.id,
        getSourceBuffer: () => getPhotoBuffer(photo.url),
      })
    } else {
      ;({ buffer } = await processPhotoForDownload({ photoUrl: photo.url, branded: false }))
    }

    const fileName = getDownloadFileName(photo, branded ? { extension: BRANDED_EXTENSION } : {})

    const duration = Date.now() - start
    console.log(`${logPrefix} event=${event.slug} photo=${photo.id} type=${type} branded=${branded} durationMs=${duration}`)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': branded ? BRANDED_CONTENT_TYPE : (photo.mimeType || 'image/jpeg'),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    const duration = Date.now() - start

    // The derivative store is degraded (not merely empty). Answering with a
    // temporary failure is deliberate: falling back to a live transform here
    // would turn a Blob incident into a transform storm.
    if (error instanceof DerivativeStorageUnavailableError) {
      console.error(`${logPrefix} Derivative storage unavailable:`, error.message, `durationMs=${duration}`)
      return NextResponse.json(
        { error: 'Download is temporarily unavailable. Please try again.' },
        { status: 503 }
      )
    }

    // Another request holds the transform lock and did not publish in time.
    // We deliberately do NOT transform — a waiter timeout never grants
    // permission to run Sharp (see STEP 7.14b §19).
    if (error instanceof DerivativePendingError) {
      console.warn(`${logPrefix} Derivative still preparing, durationMs=${duration}`)
      return NextResponse.json(
        { error: 'Download is being prepared. Please try again.' },
        { status: 503 }
      )
    }

    console.error(`${logPrefix} Unexpected error:`, error, `durationMs=${duration}`)
    return NextResponse.json(
      { error: 'Unable to process download. Please try again later.' },
      { status: 500 }
    )
  }
}
