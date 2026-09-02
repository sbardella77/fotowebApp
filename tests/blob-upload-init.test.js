import { describe, it, expect, vi } from 'vitest'
import { BlobUploadKind } from '@prisma/client'
import { createServerBoundBlobUploadInit } from '../lib/server/blob-upload-init.js'

// ─── Fake in-memory Prisma delegate ──────────────────────────────────────────

function makeFakePrisma() {
  const store = []

  const blobUploadSession = {
    create: vi.fn(async ({ data }) => {
      const record = { id: `sess-${store.length + 1}`, ...data }
      store.push(record)
      return record
    }),
    findUnique: vi.fn(async ({ where }) => {
      return store.find((r) => r.id === where.id) ?? null
    }),
    _store: store,
  }

  return { blobUploadSession }
}

// ─── Fake Vercel Blob storage driver ─────────────────────────────────────────

function makeFakeDriver(overrides = {}) {
  return {
    mode: 'vercel-blob',
    initUploadSession: vi.fn(async ({ sessionId, expectedPathname, handleUploadUrl }) => ({
      sessionId,
      storageMode: 'vercel-blob',
      uploadStrategy: 'vercel-blob-client',
      handleUploadUrl,
      pathname: expectedPathname,
    })),
    ...overrides,
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const EVENT = { id: 'event-id-1', slug: 'wedding-2026' }

const PAYLOAD = {
  fileName: 'photo.jpg',
  fileSize: 204800,
  mimeType: 'image/jpeg',
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createServerBoundBlobUploadInit', () => {
  it('ROOM_PHOTO → pathname in events/ namespace', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.pathname).toMatch(/^events\/wedding-2026\//)
  })

  it('PRIVATE_DELIVERY → pathname in private-delivery/ namespace', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      handleUploadUrl: '/api/owner/events/wedding-2026/private-delivery/blob',
    })

    expect(result.pathname).toMatch(/^private-delivery\/wedding-2026\//)
  })

  it('PHOTOGRAPHER_UPLOAD → pathname in private-delivery/ namespace', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      handleUploadUrl: '/api/photographer-upload/tok-abc/blob',
    })

    expect(result.pathname).toMatch(/^private-delivery\/wedding-2026\//)
  })

  it('sessionId in descriptor matches the persisted DB record id', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.sessionId).toBe(prisma.blobUploadSession._store[0].id)
  })

  it('expectedPathname in descriptor matches the value saved in DB', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.pathname).toBe(prisma.blobUploadSession._store[0].expectedPathname)
  })

  it('saves eventId and eventSlug to the DB session', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.eventId).toBe('event-id-1')
    expect(record.eventSlug).toBe('wedding-2026')
  })

  it('saves originalName, mimeType, and expectedSize to the DB session', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.originalName).toBe('photo.jpg')
    expect(record.mimeType).toBe('image/jpeg')
    expect(record.expectedSize).toBe(204800)
  })

  it('handles uploaderName and caption optional fields', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      uploaderName: 'Alice',
      caption: 'First dance',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploaderName).toBe('Alice')
    expect(record.caption).toBe('First dance')
  })

  it('handles null uploaderName and caption when omitted', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploaderName).toBeNull()
    expect(record.caption).toBeNull()
  })

  it('preserves handleUploadUrl for guest upload path', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.handleUploadUrl).toBe('/api/uploads/blob')
  })

  it('preserves handleUploadUrl for private delivery path', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.handleUploadUrl).toBe('/api/uploads/blob')
  })

  it('preserves handleUploadUrl for photographer upload path', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const result = await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(result.handleUploadUrl).toBe('/api/uploads/blob')
  })

  it('handleUploadUrl never embeds eventSlug, token, query string, or fragment', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    const uploadKinds = [
      { kind: BlobUploadKind.ROOM_PHOTO, url: '/api/uploads/blob' },
      { kind: BlobUploadKind.PRIVATE_DELIVERY, url: '/api/uploads/blob' },
      { kind: BlobUploadKind.PHOTOGRAPHER_UPLOAD, url: '/api/uploads/blob' },
    ]

    for (const { kind, url } of uploadKinds) {
      const result = await createServerBoundBlobUploadInit({
        prisma,
        storageDriver: driver,
        event: EVENT,
        payload: PAYLOAD,
        uploadKind: kind,
        handleUploadUrl: url,
      })

      expect(result.handleUploadUrl).not.toContain(EVENT.slug)
      expect(result.handleUploadUrl).not.toContain('?')
      expect(result.handleUploadUrl).not.toContain('#')
      expect(result.handleUploadUrl).toBe('/api/uploads/blob')
    }
  })

  it('does not store photographer token in the DB session record', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      handleUploadUrl: '/api/photographer-upload/tok-secret/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    const recordStr = JSON.stringify(record)
    expect(recordStr).not.toContain('tok-secret')
  })

  it('storage driver receives only sessionId, expectedPathname, handleUploadUrl', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    expect(driver.initUploadSession).toHaveBeenCalledTimes(1)
    const callArg = driver.initUploadSession.mock.calls[0][0]
    const keys = Object.keys(callArg)
    expect(keys).toHaveLength(3)
    expect(keys).toContain('sessionId')
    expect(keys).toContain('expectedPathname')
    expect(keys).toContain('handleUploadUrl')
  })

  it('sanitizes a malicious fileName before storing in pathname', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: {
        fileName: '../../etc/passwd',
        fileSize: 1024,
        mimeType: 'image/jpeg',
      },
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.expectedPathname).not.toContain('..')
    expect(record.expectedPathname).toMatch(/^events\/wedding-2026\//)
  })

  it('throws when prisma.blobUploadSession delegate is missing', async () => {
    const driver = makeFakeDriver()

    await expect(
      createServerBoundBlobUploadInit({
        prisma: null,
        storageDriver: driver,
        event: EVENT,
        payload: PAYLOAD,
        uploadKind: BlobUploadKind.ROOM_PHOTO,
        handleUploadUrl: '/api/uploads/blob',
      }),
    ).rejects.toThrow('prisma.blobUploadSession delegate is required')
  })

  it('throws when storageDriver is not in vercel-blob mode', async () => {
    const prisma = makeFakePrisma()
    const localDriver = { mode: 'local' }

    await expect(
      createServerBoundBlobUploadInit({
        prisma,
        storageDriver: localDriver,
        event: EVENT,
        payload: PAYLOAD,
        uploadKind: BlobUploadKind.ROOM_PHOTO,
        handleUploadUrl: '/api/uploads/blob',
      }),
    ).rejects.toThrow('storageDriver must be in vercel-blob mode')
  })

  // ─── Metadata session binding ─────────────────────────────────────────────

  it('ROOM_PHOTO: saves momentId when provided', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      momentId: 'moment-abc',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.momentId).toBe('moment-abc')
  })

  it('ROOM_PHOTO: saves all three metadata fields together', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      uploaderName: 'Bob',
      caption: 'Ceremony',
      momentId: 'moment-xyz',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploaderName).toBe('Bob')
    expect(record.caption).toBe('Ceremony')
    expect(record.momentId).toBe('moment-xyz')
  })

  it('ROOM_PHOTO: saves contributorId when provided', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      contributorId: '22222222-2222-4222-8222-222222222222',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.contributorId).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('ROOM_PHOTO: contributorId null when omitted', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.contributorId).toBeNull()
  })

  it('ROOM_PHOTO: momentId null when omitted', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.momentId).toBeNull()
  })

  it('ROOM_PHOTO: saves uploadActorType when provided (server-resolved, analytics attribution only)', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
      uploadActorType: 'owner',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploadActorType).toBe('owner')
  })

  it('ROOM_PHOTO: uploadActorType null when omitted (anonymous guest upload)', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.ROOM_PHOTO,
      handleUploadUrl: '/api/uploads/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploadActorType).toBeNull()
  })

  it('PRIVATE_DELIVERY: metadata fields are null when caller does not pass them', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PRIVATE_DELIVERY,
      handleUploadUrl: '/api/owner/events/wedding-2026/private-delivery/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploaderName).toBeNull()
    expect(record.caption).toBeNull()
    expect(record.momentId).toBeNull()
    expect(record.contributorId).toBeNull()
    // PRIVATE_DELIVERY sessions never receive uploadActorType — that upload
    // kind is attributed via PrivateAsset.uploadedByRole instead, which is
    // out of scope for this field (see lib/server/gallery-upload-actor.js).
    expect(record.uploadActorType).toBeNull()
  })

  it('PHOTOGRAPHER_UPLOAD: metadata fields are null when caller does not pass them', async () => {
    const prisma = makeFakePrisma()
    const driver = makeFakeDriver()

    await createServerBoundBlobUploadInit({
      prisma,
      storageDriver: driver,
      event: EVENT,
      payload: PAYLOAD,
      uploadKind: BlobUploadKind.PHOTOGRAPHER_UPLOAD,
      handleUploadUrl: '/api/photographer-upload/tok-abc/blob',
    })

    const record = prisma.blobUploadSession._store[0]
    expect(record.uploaderName).toBeNull()
    expect(record.caption).toBeNull()
    expect(record.momentId).toBeNull()
    expect(record.contributorId).toBeNull()
    expect(record.uploadActorType).toBeNull()
  })
})
