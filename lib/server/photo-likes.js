import { randomUUID } from 'crypto'
import { buildRateLimitResponse, jsonPrivate } from '@/lib/server/api-response'
import { normalizeContributorId } from '@/lib/server/contributor-id'
import { verifySameOriginRequest } from '@/lib/server/csrf'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { withTiming } from '@/lib/server/timing'

/**
 * Guest "mi piace" hearts on room photos.
 *
 * Guests have no account, so a voter is identified by an anonymous,
 * server-issued httpOnly cookie UUID. That makes "one heart per person"
 * best-effort only (clearing cookies votes again) — acceptable because a
 * like is display-only and never feeds authorization, billing or gating.
 *
 * Cookie-scoped responses use jsonPrivate (no wildcard CORS) and mutations
 * require a same-origin request, so a third-party page cannot cast hearts
 * with a visitor's cookie.
 */

export const VOTER_COOKIE_NAME = 'sr_voter'
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2

export function readVoterId(request) {
  return normalizeContributorId(request.cookies?.get?.(VOTER_COOKIE_NAME)?.value)
}

function withVoterCookie(response, voterId) {
  response.cookies.set(VOTER_COOKIE_NAME, voterId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VOTER_COOKIE_MAX_AGE,
  })
  return response
}

async function guard(request, slug) {
  const rateLimitCheck = await checkRateLimit(
    `photo-like:ip:${hashIdentifier(getClientIp(request))}:event:${slug}`,
    RATE_LIMITS.photoLike.ip.max,
    RATE_LIMITS.photoLike.ip.window
  )
  if (rateLimitCheck.limited) return { response: buildRateLimitResponse(rateLimitCheck) }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) return { response: jsonPrivate({ error: 'Event not found' }, 404) }

  const prisma = await getPrismaClient()
  if (!prisma) return { response: jsonPrivate({ error: 'Likes are unavailable' }, 503) }

  return { event, prisma }
}

export const getMyPhotoLikes = withTiming('getMyPhotoLikes', async (request, slug) => {
  const { response, event, prisma } = await guard(request, slug)
  if (response) return response

  const voterId = readVoterId(request)
  if (!voterId) return jsonPrivate({ likedPhotoIds: [] })

  const likes = await prisma.photoLike.findMany({
    where: { eventId: event.id, voterId },
    select: { photoId: true },
  })
  return jsonPrivate({ likedPhotoIds: likes.map((like) => like.photoId) })
})

/**
 * Idempotent: liking twice or unliking a non-liked photo is a no-op that
 * still returns the current count. The PhotoLike row and the denormalized
 * Photo.likeCount change in one transaction, keyed on the unique
 * (photoId, voterId) pair, so concurrent taps cannot double count.
 */
export const setPhotoLike = withTiming('setPhotoLike', async (request, slug, photoId, liked) => {
  const sameOrigin = verifySameOriginRequest(request)
  if (!sameOrigin.allowed) return jsonPrivate({ error: sameOrigin.message, code: sameOrigin.code }, 403)

  const { response, event, prisma } = await guard(request, slug)
  if (response) return response

  const photo = await prisma.photo.findFirst({
    where: { id: photoId, eventId: event.id, status: 'VISIBLE' },
    select: { id: true },
  })
  if (!photo) return jsonPrivate({ error: 'Photo not found' }, 404)

  const existingVoterId = readVoterId(request)
  const voterId = existingVoterId || randomUUID()

  const likeCount = await prisma.$transaction(async (tx) => {
    if (liked) {
      const created = await tx.photoLike.createMany({
        data: [{ photoId, eventId: event.id, voterId }],
        skipDuplicates: true,
      })
      if (created.count > 0) {
        await tx.photo.update({ where: { id: photoId }, data: { likeCount: { increment: 1 } } })
      }
    } else {
      const deleted = await tx.photoLike.deleteMany({ where: { photoId, voterId } })
      if (deleted.count > 0) {
        await tx.photo.updateMany({
          where: { id: photoId, likeCount: { gt: 0 } },
          data: { likeCount: { decrement: 1 } },
        })
      }
    }
    const current = await tx.photo.findUnique({ where: { id: photoId }, select: { likeCount: true } })
    return current?.likeCount ?? 0
  })

  const result = jsonPrivate({ photoId, liked, likeCount })
  return existingVoterId ? result : withVoterCookie(result, voterId)
})
