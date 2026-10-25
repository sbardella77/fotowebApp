import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    expect(muxBody.new_asset_settings.passthrough).toBe(body.photoId)
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

  it('deletes orphaned assets whose Photo row is gone', async () => {
    const prisma = { photo: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } }
    const deleteAsset = vi.fn()
    const result = await syncVideoAsset(prisma, 'asset1', { getAsset: async () => readyAsset, deleteAsset })
    expect(result.outcome).toBe('orphan_deleted')
    expect(deleteAsset).toHaveBeenCalledWith('asset1')
    expect(prisma.photo.update).not.toHaveBeenCalled()
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
    getPrismaClient.mockResolvedValue({ photo: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } })
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
  it('exposes Mux rendition URLs only when READY', () => {
    expect(toGuestVideoFields({ videoStatus: 'PROCESSING', muxPlaybackId: 'abc0123456' })).toMatchObject({ url: null, videoUrl: null })
    expect(toGuestVideoFields({ videoStatus: 'READY', muxPlaybackId: 'abc0123456', durationSec: 12.6 })).toEqual({
      mediaType: 'VIDEO',
      videoStatus: 'READY',
      url: 'https://image.mux.com/abc0123456/thumbnail.jpg?width=640&fit_mode=preserve',
      videoUrl: 'https://stream.mux.com/abc0123456/highest.mp4',
      durationSec: 13,
    })
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
