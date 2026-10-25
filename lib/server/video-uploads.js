import { randomUUID } from 'crypto'
import { json, jsonPrivate, buildRateLimitResponse, formatZodError } from '@/lib/server/api-response'
import { normalizeContributorId } from '@/lib/server/contributor-id'
import { verifySameOriginRequest } from '@/lib/server/csrf'
import { getEffectiveEventAccessState } from '@/lib/server/event-access'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { classifyGalleryUploadActor } from '@/lib/server/gallery-upload-actor'
import {
  createDirectUpload,
  deleteAsset,
  getAsset,
  getMuxScope,
  getPublicPlaybackId,
  getUpload,
  isMuxConfigured,
  parsePassthrough,
  isStaticRenditionReady,
  verifyMuxWebhookSignature,
} from '@/lib/server/mux'
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { incrementPendingPhotoDigest } from '@/lib/server/photo-digest'
import { getPrismaClient } from '@/lib/server/prisma-client'
import { checkRateLimit, getClientIp, hashIdentifier, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { MAX_VIDEO_DURATION_SEC, videoUploadInitSchema } from '@/lib/server/schemas'

/**
 * Room video uploads (guest + owner) through Mux direct uploads.
 *
 * Flow: init (this file) creates the Photo row (mediaType VIDEO,
 * videoStatus UPLOADING) and a one-shot Mux upload URL → the browser PUTs
 * the file straight to Mux → Mux webhooks drive videoStatus to READY or
 * FAILED. The server never handles video bytes.
 *
 * Videos are a paid-room capability: Free rooms are refused server-side
 * regardless of what the client shows.
 */

export const MAX_VIDEOS_PER_EVENT = 500
// Mux reports container duration; allow a little slack over the advertised cap.
const DURATION_SLACK_SEC = 5

export function buildMuxStorageUrl(eventSlug, ref) {
  return `mux://events/${eventSlug}/${ref}`
}

export const initVideoUpload = async (request) => {
  const rateLimitCheck = await checkRateLimit(
    `video-init:ip:${hashIdentifier(getClientIp(request))}`,
    RATE_LIMITS.videoInit.ip.max,
    RATE_LIMITS.videoInit.ip.window
  )
  if (rateLimitCheck.limited) return buildRateLimitResponse(rateLimitCheck)

  // The origin is also handed to Mux as the upload's CORS origin.
  const sameOrigin = verifySameOriginRequest(request)
  if (!sameOrigin.allowed) return json({ error: sameOrigin.message, code: sameOrigin.code }, 403)

  let payload
  try {
    payload = videoUploadInitSchema.parse(await request.json())
  } catch (error) {
    return json({ error: error?.issues ? formatZodError(error) : 'Invalid request body' }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(payload.eventSlug)
  if (!event) return json({ error: 'Event not found' }, 404)

  const prisma = await getPrismaClient()
  if (!prisma || !isMuxConfigured()) {
    return json({ error: 'Video uploads are temporarily unavailable.', code: 'video_unavailable' }, 503)
  }

  const access = await getEffectiveEventAccessState(prisma, event)
  if (access.isFree) {
    return json({ error: 'Videos are available in Pro rooms.', code: 'videos_require_upgrade' }, 403)
  }

  const videoCount = await prisma.photo.count({
    where: { eventId: event.id, mediaType: 'VIDEO', videoStatus: { not: 'FAILED' } },
  })
  if (videoCount >= MAX_VIDEOS_PER_EVENT) {
    return json({ error: `This room has reached its ${MAX_VIDEOS_PER_EVENT}-video limit.`, code: 'video_limit' }, 403)
  }

  let momentId = null
  if (payload.momentId) {
    const moment = await prisma.eventMoment.findFirst({ where: { id: payload.momentId, eventId: event.id }, select: { id: true } })
    momentId = moment?.id || null
  }

  const verifiedOwnerEmail = await verifyOwnerSessionToken(request.cookies?.get?.(OWNER_COOKIE_NAME)?.value)
  const uploadActorType = classifyGalleryUploadActor({ verifiedOwnerEmail, eventOwnerEmail: event.ownerEmail })

  const photoId = randomUUID()
  const upload = await createDirectUpload({ photoId, corsOrigin: sameOrigin.origin })

  await prisma.photo.create({
    data: {
      id: photoId,
      eventId: event.id,
      originalName: payload.fileName,
      storedName: `mux-upload-${upload.id}`,
      mimeType: payload.mimeType.toLowerCase(),
      size: payload.fileSize,
      url: buildMuxStorageUrl(event.slug, `upload-${upload.id}`),
      uploaderName: payload.uploaderName || null,
      caption: payload.caption || null,
      status: 'VISIBLE',
      momentId,
      contributorId: normalizeContributorId(payload.contributorId),
      uploadActorType,
      // Never READY: keeps every image-derivative consumer away from videos.
      displayDerivativeStatus: 'PENDING',
      mediaType: 'VIDEO',
      videoStatus: 'UPLOADING',
      muxUploadId: upload.id,
    },
  })
  await incrementPendingPhotoDigest(prisma, event.id)

  return json({ photoId, uploadUrl: upload.url }, 201)
}

/**
 * Re-reads the asset from Mux and writes the resulting state onto its Photo
 * row. Webhook payload shapes differ between event types and API versions,
 * so the authoritative asset — not the payload — decides the status. Safe
 * to run any number of times, in any order.
 */
export async function syncVideoAsset(prisma, assetId, deps = {}) {
  const fetchAsset = deps.getAsset || getAsset
  const removeAsset = deps.deleteAsset || deleteAsset

  const asset = await fetchAsset(assetId)
  if (!asset) {
    const failed = await markVideoAssetGone(prisma, { assetId, uploadId: deps.uploadId })
    return { outcome: 'asset_missing', failed }
  }

  // Another deployment environment's upload (preview vs production sharing
  // one Mux environment): not ours to update, and never ours to delete.
  const { scope, photoId } = parsePassthrough(asset.passthrough)
  const currentScope = deps.scope || getMuxScope()
  if (scope !== null && scope !== currentScope) return { outcome: 'foreign_scope' }

  const photo = photoId
    ? await prisma.photo.findFirst({
        where: { id: photoId, mediaType: 'VIDEO' },
        select: { id: true, eventId: true, videoStatus: true, event: { select: { slug: true } } },
      })
    : null
  if (!photo) {
    // Only an asset provably minted by THIS environment can be an orphan.
    // Legacy unscoped passthroughs may belong to another environment's
    // database, so they are left alone.
    if (scope !== currentScope) return { outcome: 'not_found_unscoped' }
    // The Photo was deleted before Mux finished: nothing will ever reference
    // this asset, so stop paying to store it.
    await removeAsset(assetId)
    return { outcome: 'orphan_deleted' }
  }

  const data = { muxAssetId: assetId, url: buildMuxStorageUrl(photo.event.slug, assetId) }

  if (asset.status === 'errored') {
    data.videoStatus = 'FAILED'
  } else if (asset.status === 'ready') {
    const duration = Number(asset.duration) || 0
    if (duration > MAX_VIDEO_DURATION_SEC + DURATION_SLACK_SEC) {
      await removeAsset(assetId)
      data.videoStatus = 'FAILED'
      data.durationSec = duration
    } else {
      data.durationSec = duration
      data.muxPlaybackId = getPublicPlaybackId(asset)
      data.videoStatus = data.muxPlaybackId && isStaticRenditionReady(asset) ? 'READY' : 'PROCESSING'
    }
  } else {
    data.videoStatus = 'PROCESSING'
  }

  // Never step back from a terminal state on a late/out-of-order event.
  if (photo.videoStatus === 'READY' || photo.videoStatus === 'FAILED') delete data.videoStatus

  await prisma.photo.update({ where: { id: photo.id }, data })
  return { outcome: data.videoStatus || photo.videoStatus, photoId: photo.id }
}

/**
 * The Mux asset behind a video no longer exists (deleted, or never created):
 * nothing can ever be played, so the video is FAILED — even if it was READY —
 * and its playback id is cleared so no dead poster/player URL is served.
 * Matching is by ids this database stored itself, so another environment's
 * rows can never be affected.
 */
export async function markVideoAssetGone(prisma, { assetId, uploadId }) {
  const or = []
  if (assetId) or.push({ muxAssetId: assetId })
  if (uploadId) or.push({ muxUploadId: uploadId })
  if (or.length === 0) return 0
  const result = await prisma.photo.updateMany({
    where: { mediaType: 'VIDEO', OR: or },
    data: { videoStatus: 'FAILED', muxPlaybackId: null },
  })
  return result.count
}

export const STUCK_UPLOAD_MS = 2 * 60 * 60 * 1000 // Mux upload URLs expire after 1 h
export const STUCK_PROCESSING_RECHECK_MS = 15 * 60 * 1000
export const STUCK_PROCESSING_FAIL_MS = 2 * 60 * 60 * 1000

/**
 * Cron safety net for videos stuck in UPLOADING/PROCESSING: a guest closed
 * the page mid-upload (no Mux event will ever come), a webhook was lost, or
 * an asset vanished. Re-reads Mux and either repairs the row (lost webhook)
 * or marks it FAILED so it stops spinning in the gallery.
 */
export async function reconcileStuckVideos(prisma, { now = Date.now(), deps = {} } = {}) {
  const fetchUpload = deps.getUpload || getUpload
  const stats = { checked: 0, repaired: 0, failed: 0 }

  const stuck = await prisma.photo.findMany({
    where: {
      mediaType: 'VIDEO',
      videoStatus: { in: ['UPLOADING', 'PROCESSING'] },
      updatedAt: { lt: new Date(now - STUCK_PROCESSING_RECHECK_MS) },
    },
    select: { id: true, videoStatus: true, muxUploadId: true, muxAssetId: true, createdAt: true },
    take: 100,
  })

  for (const video of stuck) {
    stats.checked += 1
    const age = now - new Date(video.createdAt).getTime()
    let assetId = video.muxAssetId
    if (!assetId && video.muxUploadId) {
      const upload = await fetchUpload(video.muxUploadId)
      assetId = upload?.asset_id || null
    }

    if (assetId) {
      const result = await syncVideoAsset(prisma, assetId, { ...deps, uploadId: video.muxUploadId })
      if (result.outcome === 'READY') { stats.repaired += 1; continue }
      if (result.outcome === 'asset_missing' || result.outcome === 'FAILED') { stats.failed += 1; continue }
    }

    // Still nothing playable: give up once it is clearly not coming.
    const limit = video.videoStatus === 'UPLOADING' ? STUCK_UPLOAD_MS : STUCK_PROCESSING_FAIL_MS
    if (age > limit) {
      await prisma.photo.updateMany({
        where: { id: video.id, videoStatus: { in: ['UPLOADING', 'PROCESSING'] } },
        data: { videoStatus: 'FAILED' },
      })
      stats.failed += 1
    }
  }
  return stats
}

export const handleMuxWebhook = async (request, deps = {}) => {
  const rawBody = await request.text()
  if (!verifyMuxWebhookSignature(rawBody, request.headers.get('mux-signature'))) {
    return jsonPrivate({ error: 'Invalid signature' }, 401)
  }

  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return jsonPrivate({ error: 'Invalid JSON' }, 400)
  }

  const prisma = await getPrismaClient()
  if (!prisma) return jsonPrivate({ error: 'Database unavailable' }, 503)

  const type = typeof payload?.type === 'string' ? payload.type : ''
  const data = payload?.data || {}

  if (type === 'video.asset.deleted') {
    if (typeof data.id === 'string') await markVideoAssetGone(prisma, { assetId: data.id })
    return jsonPrivate({ ok: true })
  }

  if (type === 'video.upload.errored' || type === 'video.upload.cancelled' || type === 'video.upload.timed_out') {
    if (typeof data.id === 'string') {
      await prisma.photo.updateMany({
        where: { muxUploadId: data.id, videoStatus: { in: ['UPLOADING', 'PROCESSING'] } },
        data: { videoStatus: 'FAILED' },
      })
    }
    return jsonPrivate({ ok: true })
  }

  let assetId = null
  let uploadId = null
  if (type === 'video.upload.asset_created') { assetId = data.asset_id; uploadId = data.id }
  else if (type.startsWith('video.asset.static_rendition')) assetId = data.asset_id
  else if (type.startsWith('video.asset.')) assetId = data.id

  if (typeof assetId === 'string' && assetId) {
    // Errors propagate → 500 → Mux retries the delivery.
    await syncVideoAsset(prisma, assetId, { ...deps, uploadId: typeof uploadId === 'string' ? uploadId : undefined })
  }
  return jsonPrivate({ ok: true })
}
