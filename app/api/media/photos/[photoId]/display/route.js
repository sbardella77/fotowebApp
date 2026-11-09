import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { getActiveWatermarkForOwnerId } from '@/lib/server/photographer-watermark-delivery'
import { ensurePhotoWatermarkDisplay, PWM_DISPLAY_KIND } from '@/lib/server/photographer-watermark-derivative'
import { getDisplayDerivativeOrigin, resolveGuestPhotoUrl } from '@/lib/server/guest-photo-url'
import { isValidWatermarkRevision } from '@/lib/server/photographer-watermark-config'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const NO_STORE = 'no-store'
// Safe to cache for a long time: the URL carries the revision and the target
// is always the watermarked, revision-keyed derivative.
const IMMUTABLE = 'public, max-age=86400, s-maxage=31536000, immutable'

function redirect(url, cacheControl) {
  const response = NextResponse.redirect(url, 302)
  response.headers.set('Cache-Control', cacheControl)
  return response
}

function errorResponse(message, status, extraHeaders = {}) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': NO_STORE, ...extraHeaders } })
}

/**
 * GET /api/media/photos/{photoId}/display?r={revision}
 *
 * Renders (at most once per photo and revision) the photographer-watermarked
 * display derivative and redirects to it. Guest DTOs point here only while a
 * photo's derivative for the current revision is not yet confirmed.
 *
 * Never serves or redirects to a clean rendition while the owner's watermark
 * is active, and never renders for a revision that is not the current one.
 */
export async function GET(request, { params }) {
  const photoId = params?.photoId
  const revision = new URL(request.url).searchParams.get('r')
  if (typeof photoId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(photoId) || !isValidWatermarkRevision(revision)) {
    return errorResponse('Invalid request', 400)
  }

  const limit = await checkRateLimit(
    `media-display-broad:ip:${hashIdentifier(getClientIp(request))}`,
    RATE_LIMITS.mediaDisplayBroad.ip.max,
    RATE_LIMITS.mediaDisplayBroad.ip.window,
  )
  if (limit.limited) return errorResponse('Too many requests', 429, { 'Retry-After': '30' })

  const prisma = await getPrismaClient()
  if (!prisma) return errorResponse('Service unavailable', 503, { 'Retry-After': '5' })

  const photo = await prisma.photo.findFirst({
    where: { id: photoId, status: 'VISIBLE', mediaType: 'IMAGE', displayDerivativeStatus: 'READY' },
    select: { id: true, url: true, mediaType: true, displayDerivativeStatus: true, watermarkDisplayRevision: true, event: { select: { ownerId: true } } },
  })
  if (!photo) return errorResponse('Not found', 404)

  const watermark = await getActiveWatermarkForOwnerId(prisma, photo.event?.ownerId)
  if (!watermark || watermark.revision !== revision) {
    // Stale link (watermark changed or turned off): send the browser to
    // whatever is current, without caching this hop.
    const current = resolveGuestPhotoUrl(photo, { watermark })
    if (!current || current.startsWith('/api/media/')) return errorResponse('Not found', 404)
    return redirect(current, NO_STORE)
  }

  // Best-effort helper: pending/storage/transform failures come back as
  // ok:false (already logged) and map to a retryable 503.
  const result = await ensurePhotoWatermarkDisplay({ prisma, photo, spec: watermark, operation: 'mediaDisplay' })
  if (!result.ok) return errorResponse('Image is being prepared', 503, { 'Retry-After': '2' })

  return redirect(`${getDisplayDerivativeOrigin()}/${PWM_DISPLAY_KIND.buildPath(photo.id, watermark)}`, IMMUTABLE)
}
