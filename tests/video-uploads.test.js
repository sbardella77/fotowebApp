import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { createHmac } from 'crypto'

vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient }))

const { getGalleryRepository } = vi.hoisted(() => ({ getGalleryRepository: vi.fn() }))
vi.mock('@/lib/server/gallery-repository', () => ({
  getGalleryRepository,
  getGalleryRepositoryMode: vi.fn().mockResolvedValue('local'),
}))

const { getEffectiveEventAccessState } = vi.hoisted(() => ({ getEffectiveEventAccessState: vi.fn() }))
vi.mock('@/lib/server/event-access', () => ({ getEffectiveEventAccessState }))

import { handleMuxWebhook, initVideoUpload, syncVideoAsset } from '@/lib/server/video-uploads'
import { isStaticRenditionReady, verifyMuxWebhookSignature } from '@/lib/server/mux'
import { toGuestVideoFields } from '@/lib/server/guest-video-fields'
import { deleteEventScopedStoredFile } from '@/lib/server/event-scoped-storage-delete'
import { normalizePublicPhoto } from '@/lib/photo-utils'
import { normalizePhotoRecord } from '@/lib/server/repository-mappers'
import { ensurePhotoDisplayDerivativeStatus } from '@/lib/server/photo-display-derivative-status'

const SECRET = 'whsec_test'
const sign = (body, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`

const EVENT = { id: 'event-1', slug: 'party', ownerEmail: 'owner@example.com' }

function initRequest(body, { origin = 'http://localhost:3000' } = {}) {
  return {
    headers: { get: (n) => (n === 'origin' ? origin : n === 'x-forwarded-for' ? '203.0.113.5' : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  }
}

const validInit = { eventSlug: 'party', fileName: 'clip.mov', fileSize: 20_000_000, mimeType: 'video/quicktime', uploaderName: 'Ana' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  process.env.APP_URL = 'http://localhost:3000'
  process.env.MUX_TOKEN_ID = 'id'
  process.env.MUX_TOKEN_SECRET = 'secret'
  process.env.MUX_WEBHOOK_SECRET = SECRET
  getGalleryRepository.mockResolvedValue({ getEventBySlug: vi.fn().mockResolvedValue(EVENT) })
})

describe('initVideoUpload', () => {
  it('refuses videos in Free rooms server-side, before calling Mux', async () => {
    const prisma = { photo: { count: vi.fn(), create: vi.fn() } }
    getPrismaClient.mockResolvedValue(prisma)
    getEffectiveEventAccessState.mockResolvedValue({ isFree: true })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await initVideoUpload(initRequest(validInit))

    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('videos_require_upgrade')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prisma.photo.create).not.toHaveBeenCalled()
  })

  it('rejects oversized files and non-video types', async () => {
    getPrismaClient.mockResolvedValue({})
    expect((await initVideoUpload(initRequest({ ...validInit, fileSize: 151 * 1024 * 1024 }))).status).toBe(400)
    expect((await initVideoUpload(initRequest({ ...validInit, mimeType: 'image/jpeg' }))).status).toBe(400)
  })

  it('creates a Mux direct upload and a VIDEO row that never exposes an original URL', async () => {
    const prisma = {
      photo: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}) },
      event: { update: vi.fn().mockResolvedValue({}) },
      eventMoment: { findFirst: vi.fn() },
    }
    getPrismaClient.mockResolvedValue(prisma)
    getEffectiveEventAccessState.mockResolvedValue({ isFree: false })
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'up123', url: 'https://storage.mux.com/up' } }) }))
    vi.stubGlobal('fetch', fetchSpy)

    const res = await initVideoUpload(initRequest(validInit))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.uploadUrl).toBe('https://storage.mux.com/up')
    const muxBody = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(muxBody.cors_origin).toBe('http://localhost:3000')
    expect(muxBody.new_asset_settings.passthrough).toBe(`${process.env.VERCEL_ENV || process.env.NODE_ENV}:${body.photoId}`)
    expect(muxBody.new_asset_settings.playback_policies).toEqual(['public'])

    const data = prisma.photo.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      id: body.photoId,
      mediaType: 'VIDEO',
      videoStatus: 'UPLOADING',
      muxUploadId: 'up123',
      displayDerivativeStatus: 'PENDING',
      url: 'mux://events/party/upload-up123',
    })
  })
})

describe('syncVideoAsset', () => {
  const photoRow = { id: 'p1', eventId: 'event-1', videoStatus: 'PROCESSING', event: { slug: 'party' } }
  const readyAsset = {
    id: 'asset1',
    status: 'ready',
    passthrough: 'p1',
    duration: 31.4,
    playback_ids: [{ id: 'PlaybackId0123', policy: 'public' }],
    static_renditions: { files: [{ status: 'ready', name: 'highest.mp4' }] },
  }

  it('marks READY once the MP4 static rendition is ready', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(photoRow), update: vi.fn() } }
    await syncVideoAsset(prisma, 'asset1', { getAsset: async () => readyAsset, deleteAsset: vi.fn() })
    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: {
        muxAssetId: 'asset1',
        url: 'mux://events/party/asset1',
        durationSec: 31.4,
        muxPlaybackId: 'PlaybackId0123',
        videoStatus: 'READY',
      },
    })
  })

  it('stays PROCESSING while the asset is ready but the MP4 is not', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(photoRow), update: vi.fn() } }
    const asset = { ...readyAsset, static_renditions: { files: [{ status: 'preparing' }] } }
    await syncVideoAsset(prisma, 'asset1', { getAsset: async () => asset, deleteAsset: vi.fn() })
    expect(prisma.photo.update.mock.calls[0][0].data.videoStatus).toBe('PROCESSING')
  })

  it('deletes and fails videos longer than the cap', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(photoRow), update: vi.fn() } }
    const deleteAsset = vi.fn()
    await syncVideoAsset(prisma, 'asset1', { getAsset: async () => ({ ...readyAsset, duration: 120 }), deleteAsset })
    expect(deleteAsset).toHaveBeenCalledWith('asset1')
    expect(prisma.photo.update.mock.calls[0][0].data.videoStatus).toBe('FAILED')
  })

  it('deletes orphaned assets this environment minted whose Photo row is gone', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } }
    const deleteAsset = vi.fn()
    const asset = { ...readyAsset, passthrough: 'production:p1' }
    const result = await syncVideoAsset(prisma, 'asset1', { getAsset: async () => asset, deleteAsset, scope: 'production' })
    expect(result.outcome).toBe('orphan_deleted')
    expect(deleteAsset).toHaveBeenCalledWith('asset1')
    expect(prisma.photo.update).not.toHaveBeenCalled()
  })

  it('never touches another environment\'s asset (shared Mux env: preview must not delete production videos)', async () => {
    const prisma = { photo: { findFirst: vi.fn(), update: vi.fn() } }
    const deleteAsset = vi.fn()
    const asset = { ...readyAsset, passthrough: 'production:p1' }
    const result = await syncVideoAsset(prisma, 'asset1', { getAsset: async () => asset, deleteAsset, scope: 'preview' })
    expect(result.outcome).toBe('foreign_scope')
    expect(deleteAsset).not.toHaveBeenCalled()
    expect(prisma.photo.findFirst).not.toHaveBeenCalled()
    expect(prisma.photo.update).not.toHaveBeenCalled()
  })

  it('does not delete legacy unscoped assets it cannot find (they may be another environment\'s)', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } }
    const deleteAsset = vi.fn()
    const result = await syncVideoAsset(prisma, 'asset1', { getAsset: async () => readyAsset, deleteAsset, scope: 'production' })
    expect(result.outcome).toBe('not_found_unscoped')
    expect(deleteAsset).not.toHaveBeenCalled()
  })

  it('never steps back from READY on a late event', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue({ ...photoRow, videoStatus: 'READY' }), update: vi.fn() } }
    await syncVideoAsset(prisma, 'asset1', { getAsset: async () => ({ ...readyAsset, status: 'preparing' }), deleteAsset: vi.fn() })
    expect(prisma.photo.update.mock.calls[0][0].data.videoStatus).toBeUndefined()
  })
})

describe('handleMuxWebhook', () => {
  const webhookRequest = (payload, signature) => {
    const raw = JSON.stringify(payload)
    return { text: async () => raw, headers: { get: (n) => (n === 'mux-signature' ? signature ?? sign(raw) : null) } }
  }

  it('rejects unsigned or forged deliveries', async () => {
    const res = await handleMuxWebhook(webhookRequest({ type: 'video.asset.ready', data: { id: 'a' } }, 't=1,v1=bad'))
    expect(res.status).toBe(401)
  })

  it('routes static rendition events (both spellings) by data.asset_id', async () => {
    getPrismaClient.mockResolvedValue({ photo: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } })
    for (const type of ['video.asset.static_rendition.ready', 'video.asset.static_renditions.ready']) {
      const getAsset = vi.fn().mockResolvedValue(null)
      const res = await handleMuxWebhook(webhookRequest({ type, data: { id: 'rendition', asset_id: 'asset9' } }), { getAsset })
      expect(res.status).toBe(200)
      expect(getAsset).toHaveBeenCalledWith('asset9')
    }
  })

  it('marks failed uploads', async () => {
    const updateMany = vi.fn()
    getPrismaClient.mockResolvedValue({ photo: { updateMany } })
    await handleMuxWebhook(webhookRequest({ type: 'video.upload.errored', data: { id: 'up1' } }))
    expect(updateMany).toHaveBeenCalledWith({
      where: { muxUploadId: 'up1', videoStatus: { in: ['UPLOADING', 'PROCESSING'] } },
      data: { videoStatus: 'FAILED' },
    })
  })
})

describe('mux helpers', () => {
  it('verifies signatures and enforces the timestamp tolerance', () => {
    const body = '{"a":1}'
    expect(verifyMuxWebhookSignature(body, sign(body), { secret: SECRET })).toBe(true)
    expect(verifyMuxWebhookSignature(body + ' ', sign(body), { secret: SECRET })).toBe(false)
    expect(verifyMuxWebhookSignature(body, sign(body, 1000), { secret: SECRET })).toBe(false)
    expect(verifyMuxWebhookSignature(body, sign(body), { secret: '' })).toBe(false)
  })

  it('understands both static rendition shapes', () => {
    expect(isStaticRenditionReady({ static_renditions: { status: 'ready' } })).toBe(true)
    expect(isStaticRenditionReady({ static_renditions: { files: [{ status: 'preparing' }] } })).toBe(false)
    expect(isStaticRenditionReady({})).toBe(false)
  })
})

describe('video DTO and guardrails', () => {
  it('exposes nothing before the Mux asset is encoded', () => {
    expect(toGuestVideoFields({ videoStatus: 'UPLOADING', muxPlaybackId: null })).toMatchObject({ url: null, videoUrl: null, hlsUrl: null })
    expect(toGuestVideoFields({ videoStatus: 'FAILED', muxPlaybackId: 'abc0123456' })).toMatchObject({ url: null, videoUrl: null, hlsUrl: null })
  })

  it('serves poster + HLS as soon as the asset is encoded, MP4 only once READY', () => {
    expect(toGuestVideoFields({ videoStatus: 'PROCESSING', muxPlaybackId: 'abc0123456' })).toMatchObject({
      url: 'https://image.mux.com/abc0123456/thumbnail.jpg?width=640&fit_mode=preserve',
      hlsUrl: 'https://stream.mux.com/abc0123456.m3u8',
      videoUrl: null,
    })
    expect(toGuestVideoFields({ videoStatus: 'READY', muxPlaybackId: 'abc0123456', durationSec: 12.6 })).toEqual({
      mediaType: 'VIDEO',
      videoStatus: 'READY',
      url: 'https://image.mux.com/abc0123456/thumbnail.jpg?width=640&fit_mode=preserve',
      videoUrl: 'https://stream.mux.com/abc0123456/highest.mp4',
      hlsUrl: 'https://stream.mux.com/abc0123456.m3u8',
      durationSec: 13,
    })
  })

  it('client normalizer keeps local blob previews and Mux HLS, drops anything else', () => {
    const p = normalizePublicPhoto({ id: 'p9', url: null, mediaType: 'VIDEO', videoUrl: 'blob:https://snaprooms.app/x', localPreview: true, hlsUrl: 'https://evil.example/a.m3u8' })
    expect(p.videoUrl).toBe('blob:https://snaprooms.app/x')
    expect(p.localPreview).toBe(true)
    expect(p.hlsUrl).toBeNull()
  })

  it('never maps a VIDEO row to its mux:// storage reference, even for owners', () => {
    const row = { id: 'p1', mediaType: 'VIDEO', url: 'mux://events/party/asset1', muxAssetId: 'asset1', muxUploadId: 'up1', videoStatus: 'READY', muxPlaybackId: 'abc0123456', displayDerivativeStatus: 'PENDING' }
    for (const guestSafe of [true, false]) {
      const dto = normalizePhotoRecord(row, { guestSafe })
      expect(dto.url).toMatch(/^https:\/\/image\.mux\.com\//)
      expect(dto).not.toHaveProperty('muxAssetId')
      expect(dto).not.toHaveProperty('muxUploadId')
    }
  })

  it('client normalizer drops non-Mux video URLs', () => {
    const p = normalizePublicPhoto({ id: 'p1', url: null, mediaType: 'VIDEO', videoUrl: 'https://evil.example/x.mp4' })
    expect(p.videoUrl).toBeNull()
    expect(normalizePublicPhoto({ id: 'p2', url: '/a.jpg' }).mediaType).toBe('IMAGE')
  })

  it('event-scoped delete accepts only mux refs naming the owning event', async () => {
    const deleteFile = vi.fn()
    await deleteEventScopedStoredFile({ url: 'mux://events/party/asset1', eventSlug: 'party', kind: 'room-photo', deleteFile })
    expect(deleteFile).toHaveBeenCalledWith('mux://events/party/asset1')
    deleteFile.mockClear()
    await deleteEventScopedStoredFile({ url: 'mux://events/other/asset1', eventSlug: 'party', kind: 'room-photo', deleteFile })
    await deleteEventScopedStoredFile({ url: 'mux://events/party/asset1', eventSlug: 'party', kind: 'private-asset', deleteFile })
    await deleteEventScopedStoredFile({ url: 'mux://events/party/../x', eventSlug: 'party', kind: 'room-photo', deleteFile })
    expect(deleteFile).not.toHaveBeenCalled()
  })

  it('image derivative pipeline skips videos', async () => {
    const ensure = vi.fn()
    const prisma = { photo: { updateMany: vi.fn() } }
    const result = await ensurePhotoDisplayDerivativeStatus({ prisma, photo: { id: 'p1', mediaType: 'VIDEO' }, operation: 'test', ensure })
    expect(result.status).toBe('SKIPPED')
    expect(ensure).not.toHaveBeenCalled()
    expect(prisma.photo.updateMany).not.toHaveBeenCalled()
  })
})

describe('processing video refresh helpers', async () => {
  const { isPendingVideo, mergePhotoUpdates } = await import('@/lib/photo-utils')

  it('flags only uploading/processing videos as pending', () => {
    expect(isPendingVideo({ mediaType: 'VIDEO', videoStatus: 'PROCESSING' })).toBe(true)
    expect(isPendingVideo({ mediaType: 'VIDEO', videoStatus: 'UPLOADING' })).toBe(true)
    expect(isPendingVideo({ mediaType: 'VIDEO', videoStatus: 'READY' })).toBe(false)
    expect(isPendingVideo({ mediaType: 'IMAGE' })).toBe(false)
  })

  it('swaps updated items in place, keeping order, length and unrelated items', () => {
    const current = [{ id: 'a', v: 1 }, { id: 'b', videoStatus: 'PROCESSING' }, { id: 'c', v: 1 }]
    const next = mergePhotoUpdates(current, [{ id: 'b', videoStatus: 'READY' }, { id: 'z' }])
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(next[1].videoStatus).toBe('READY')
    expect(next[0]).toBe(current[0])
    expect(mergePhotoUpdates(current, [{ id: 'z' }])).toBe(current)
  })
})

describe('stuck / vanished videos', async () => {
  const { markVideoAssetGone, reconcileStuckVideos, STUCK_UPLOAD_MS } = await import('@/lib/server/video-uploads')
  const NOW = Date.parse('2026-10-26T10:00:00Z')

  it('marks a video FAILED (and clears its playback id) when its Mux asset is gone', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = { photo: { updateMany } }
    await syncVideoAsset(prisma, 'gone', { getAsset: async () => null, uploadId: 'up9' })
    expect(updateMany).toHaveBeenCalledWith({
      where: { mediaType: 'VIDEO', OR: [{ muxAssetId: 'gone' }, { muxUploadId: 'up9' }] },
      data: { videoStatus: 'FAILED', muxPlaybackId: null },
    })
    expect(await markVideoAssetGone(prisma, {})).toBe(0)
  })

  it('handles video.asset.deleted webhooks', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    getPrismaClient.mockResolvedValue({ photo: { updateMany } })
    const raw = JSON.stringify({ type: 'video.asset.deleted', data: { id: 'a1' } })
    const t = Math.floor(Date.now() / 1000)
    const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`
    const res = await handleMuxWebhook({ text: async () => raw, headers: { get: () => sig } })
    expect(res.status).toBe(200)
    expect(updateMany.mock.calls[0][0].where).toEqual({ mediaType: 'VIDEO', OR: [{ muxAssetId: 'a1' }] })
  })

  it('fails an abandoned upload (no asset ever created) after the upload window', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      photo: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', videoStatus: 'UPLOADING', muxUploadId: 'up1', muxAssetId: null, createdAt: new Date(NOW - STUCK_UPLOAD_MS - 1000) }]),
        updateMany,
      },
    }
    const stats = await reconcileStuckVideos(prisma, { now: NOW, deps: { getUpload: async () => ({ id: 'up1', status: 'timed_out' }) } })
    expect(stats).toEqual({ checked: 1, repaired: 0, failed: 1 })
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'p1', videoStatus: { in: ['UPLOADING', 'PROCESSING'] } }, data: { videoStatus: 'FAILED' } })
  })

  it('leaves a young upload alone', async () => {
    const updateMany = vi.fn()
    const prisma = { photo: { findMany: vi.fn().mockResolvedValue([{ id: 'p1', videoStatus: 'UPLOADING', muxUploadId: 'up1', muxAssetId: null, createdAt: new Date(NOW - 20 * 60 * 1000) }]), updateMany } }
    const stats = await reconcileStuckVideos(prisma, { now: NOW, deps: { getUpload: async () => ({ id: 'up1', status: 'waiting' }) } })
    expect(stats.failed).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('repairs a video whose READY webhook was lost', async () => {
    const update = vi.fn()
    const prisma = {
      photo: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', videoStatus: 'PROCESSING', muxUploadId: 'up1', muxAssetId: 'asset1', createdAt: new Date(NOW - 30 * 60 * 1000) }]),
        findFirst: vi.fn().mockResolvedValue({ id: 'p1', eventId: 'e', videoStatus: 'PROCESSING', event: { slug: 'party' } }),
        update,
        updateMany: vi.fn(),
      },
    }
    const asset = { id: 'asset1', status: 'ready', passthrough: 'test:p1', duration: 10, playback_ids: [{ id: 'PlaybackId0123', policy: 'public' }], static_renditions: { status: 'ready' } }
    const stats = await reconcileStuckVideos(prisma, { now: NOW, deps: { getAsset: async () => asset, scope: 'test' } })
    expect(stats).toEqual({ checked: 1, repaired: 1, failed: 0 })
    expect(update.mock.calls[0][0].data.videoStatus).toBe('READY')
  })

  it('hides failed videos from the guest gallery', () => {
    expect(normalizePublicPhoto({ id: 'v1', url: null, mediaType: 'VIDEO', videoStatus: 'FAILED' })).toBeNull()
    expect(normalizePublicPhoto({ id: 'v2', url: null, mediaType: 'VIDEO', videoStatus: 'PROCESSING' })).not.toBeNull()
  })
})
