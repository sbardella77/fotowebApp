import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { getDownloadFileName } from '@/lib/server/download-utils'
import {
  resolveDownloadRepresentation,
  OriginalDownloadForbiddenError,
  normalizeDownloadQuality,
} from '@/lib/server/download-representation'
import {
  DerivativeStorageUnavailableError,
  DerivativePendingError,
} from '@/lib/server/download-derivative'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

/** GET /api/download/photo?photoId={id}&type={standard|original} */
export async function GET(request) {
  const logPrefix = '[download/photo]'
  const start = Date.now()
  try {
    const { searchParams } = new URL(request.url)
    const photoId = searchParams.get('photoId')
    const type = normalizeDownloadQuality(searchParams.get('type'))

    if (!photoId || typeof photoId !== 'string') {
      return NextResponse.json({ error: 'photoId is required' }, { status: 400 })
    }

    const clientIp = getClientIp(request)
    const broadLimit = await checkRateLimit(
      `download-photo-broad:ip:${hashIdentifier(clientIp)}`,
      RATE_LIMITS.downloadPhotoBroad.ip.max,
      RATE_LIMITS.downloadPhotoBroad.ip.window,
    )
    if (broadLimit.limited) {
      return NextResponse.json({ error: 'Too many download requests. Please try again later.' }, { status: 429 })
    }

    const prisma = await getPrismaClient()
    if (!prisma) return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })

    const photo = await prisma.photo.findFirst({
      where: { id: photoId, status: 'VISIBLE' },
      select: { id: true, eventId: true, originalName: true, storedName: true, mimeType: true, url: true },
    })
    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    const event = await prisma.event.findUnique({
      where: { id: photo.eventId },
      select: { id: true, slug: true, billingTier: true, originalDownloadUnlocked: true, ownerId: true },
    })
    if (!event) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })

    const access = await getEffectiveEventAccessState(prisma, event)
    const representation = await resolveDownloadRepresentation({
      photo,
      requestedQuality: type,
      access,
    })
    const fileName = getDownloadFileName(
      photo,
      representation.extension ? { extension: representation.extension } : {},
    )

    console.log(`${logPrefix} event=${event.slug} photo=${photo.id} type=${type} representation=${representation.representation} durationMs=${Date.now() - start}`)

    return new NextResponse(representation.buffer, {
      status: 200,
      headers: {
        'Content-Type': representation.contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    const duration = Date.now() - start
    if (error instanceof OriginalDownloadForbiddenError) {
      return NextResponse.json({ error: 'Original quality is not available for this event.' }, { status: 403 })
    }
    if (error instanceof DerivativeStorageUnavailableError) {
      console.error(`${logPrefix} Derivative storage unavailable durationMs=${duration}`)
      return NextResponse.json({ error: 'Download is temporarily unavailable. Please try again.' }, { status: 503 })
    }
    if (error instanceof DerivativePendingError) {
      console.warn(`${logPrefix} Derivative still preparing durationMs=${duration}`)
      return NextResponse.json({ error: 'Download is being prepared. Please try again.' }, { status: 503 })
    }
    console.error(`${logPrefix} Unexpected download failure durationMs=${duration}`)
    return NextResponse.json({ error: 'Unable to process download. Please try again later.' }, { status: 500 })
  }
}
