import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lifecycle and reconciliation of photographer-watermark (pwm) derivatives
// and watermark logos. As in derivative-cleanup.test.js, the dominant risk is
// deleting something that must survive, so many assertions are negative.

vi.mock('@vercel/blob', () => ({ del: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/server/prisma-client', () => ({ getPrismaClient: vi.fn() }))
vi.mock('@/lib/server/storage', () => ({ getStorageMode: vi.fn(() => 'vercel-blob') }))

import { del, list } from '@vercel/blob'
import { getPrismaClient } from '@/lib/server/prisma-client'
import {
  cleanupPhotoDerivatives,
  deletePhotoDerivatives,
  parsePwmPathname,
  PWM_REVISION_GRACE_MS,
} from '@/lib/server/derivative-cleanup'

const PHOTO = '00000001-0000-4000-8000-000000000001'
const REV_CURRENT = '0123456789abcdef'
const REV_OLD = 'fedcba9876543210'
const NOW = Date.parse('2026-11-05T12:00:00Z')

const pwm = (id, variant, rev) => `derivatives/pwm-v1/${id}/${variant}-${rev}.jpg`
const blob = (pathname, uploadedAt = new Date(NOW - 2 * PWM_REVISION_GRACE_MS)) => ({ pathname, uploadedAt })
const deletedPaths = () => del.mock.calls.flatMap(([arg]) => (Array.isArray(arg) ? arg : [arg]))
const silentLogger = { warn: vi.fn(), error: vi.fn(), log: vi.fn() }

/** list() answers by prefix; unknown prefixes are empty. */
function listByPrefix(pagesByPrefix) {
  list.mockImplementation(async ({ prefix }) => pagesByPrefix[prefix] ?? { blobs: [], hasMore: false })
}

function makePrisma({ photos = [], logos = [] } = {}) {
  return {
    photo: {
      findMany: vi.fn(async ({ where }) => photos.filter((p) => where.id.in.includes(p.id))),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    ownerWatermark: {
      findMany: vi.fn(async ({ where }) => logos.filter((l) => where.logoPathname.in.includes(l)).map((logoPathname) => ({ logoPathname }))),
    },
  }
}

function photoRow({ status = 'VISIBLE', column = REV_CURRENT, watermark = { revision: REV_CURRENT, revisionChangedAt: new Date(NOW - 2 * PWM_REVISION_GRACE_MS) } } = {}) {
  return { id: PHOTO, status, watermarkDisplayRevision: column, event: { owner: { watermark } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  del.mockResolvedValue(undefined)
})

describe('parsePwmPathname', () => {
  it('parses exactly what the builder produces', () => {
    expect(parsePwmPathname(pwm(PHOTO, 'display', REV_CURRENT))).toEqual({ photoId: PHOTO, variant: 'display', revision: REV_CURRENT })
    expect(parsePwmPathname(pwm(PHOTO, 'original', REV_OLD))).toEqual({ photoId: PHOTO, variant: 'original', revision: REV_OLD })
  })

  it.each([
    ['unknown variant', `derivatives/pwm-v1/${PHOTO}/thumb-${REV_CURRENT}.jpg`],
    ['short revision', `derivatives/pwm-v1/${PHOTO}/display-0123.jpg`],
    ['uppercase revision', `derivatives/pwm-v1/${PHOTO}/display-0123456789ABCDEF.jpg`],
    ['other version', `derivatives/pwm-v2/${PHOTO}/display-${REV_CURRENT}.jpg`],
    ['nested path', `derivatives/pwm-v1/${PHOTO}/x/display-${REV_CURRENT}.jpg`],
    ['non-uuid id', `derivatives/pwm-v1/not-a-uuid/display-${REV_CURRENT}.jpg`],
    ['source original', `events/wedding/${PHOTO}.jpg`],
    ['wrong extension', `derivatives/pwm-v1/${PHOTO}/display-${REV_CURRENT}.png`],
  ])('rejects %s', (_label, pathname) => {
    expect(parsePwmPathname(pathname)).toBeNull()
  })
})

describe('lifecycle deletion', () => {
  it('lists the photo folder, deletes every parsed pwm object and resets the column', async () => {
    const prisma = makePrisma()
    getPrismaClient.mockResolvedValue(prisma)
    listByPrefix({
      [`derivatives/pwm-v1/${PHOTO}/`]: { blobs: [blob(pwm(PHOTO, 'display', REV_CURRENT)), blob(pwm(PHOTO, 'original', REV_OLD)), blob(`derivatives/pwm-v1/${PHOTO}/junk.txt`)], hasMore: false },
    })

    await deletePhotoDerivatives(PHOTO, { logger: silentLogger })

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: `derivatives/pwm-v1/${PHOTO}/` }))
    expect(deletedPaths()).toEqual(expect.arrayContaining([pwm(PHOTO, 'display', REV_CURRENT), pwm(PHOTO, 'original', REV_OLD)]))
    expect(deletedPaths()).not.toContain(`derivatives/pwm-v1/${PHOTO}/junk.txt`)
    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: { in: [PHOTO] } }, data: { watermarkDisplayRevision: null } })
  })

  it('a listing failure never throws and still deletes the fixed-path kinds', async () => {
    getPrismaClient.mockResolvedValue(makePrisma())
    list.mockRejectedValue(new Error('blob down'))

    const result = await deletePhotoDerivatives(PHOTO, { logger: silentLogger })

    expect(result.failed).toBe(1)
    expect(deletedPaths()).toEqual([`derivatives/wm-v2/${PHOTO}.jpg`, `derivatives/display-v1/${PHOTO}.jpg`])
  })
})

describe('reconciliation sweep — pwm', () => {
  async function sweep(row, objects) {
    const prisma = makePrisma({ photos: row ? [row] : [] })
    getPrismaClient.mockResolvedValue(prisma)
    listByPrefix({ 'derivatives/pwm-v1/': { blobs: objects.map((p) => blob(p)), hasMore: false } })
    const stats = await cleanupPhotoDerivatives({ logger: silentLogger, now: () => NOW })
    return { stats, prisma }
  }

  it('keeps the current revision of a visible photo', async () => {
    const { stats } = await sweep(photoRow(), [pwm(PHOTO, 'display', REV_CURRENT), pwm(PHOTO, 'original', REV_CURRENT)])
    expect(stats.visibleKept).toBe(2)
    expect(del).not.toHaveBeenCalled()
  })

  it('deletes an old revision once the grace period has passed', async () => {
    const { stats } = await sweep(photoRow(), [pwm(PHOTO, 'display', REV_OLD)])
    expect(stats.pwmStaleRevisionDeleted).toBe(1)
    expect(deletedPaths()).toEqual([pwm(PHOTO, 'display', REV_OLD)])
  })

  it('keeps an old revision within the grace period', async () => {
    const recent = photoRow({ watermark: { revision: REV_CURRENT, revisionChangedAt: new Date(NOW - 60_000) } })
    await sweep(recent, [pwm(PHOTO, 'display', REV_OLD)])
    expect(del).not.toHaveBeenCalled()
  })

  it.each([
    ['photo absent', null, 'absentDeleted'],
    ['photo hidden', photoRow({ status: 'HIDDEN' }), 'hiddenDeleted'],
    ['owner removed the watermark', photoRow({ watermark: null }), 'pwmStaleRevisionDeleted'],
  ])('deletes when %s', async (_label, row, counter) => {
    const { stats } = await sweep(row, [pwm(PHOTO, 'display', REV_CURRENT)])
    expect(stats[counter]).toBe(1)
    expect(deletedPaths()).toEqual([pwm(PHOTO, 'display', REV_CURRENT)])
  })

  it('resets the column before deleting the object it points at', async () => {
    const order = []
    const prisma = makePrisma({ photos: [photoRow({ column: REV_OLD })] })
    prisma.photo.updateMany.mockImplementation(async () => { order.push('column') })
    del.mockImplementation(async () => { order.push('delete') })
    getPrismaClient.mockResolvedValue(prisma)
    listByPrefix({ 'derivatives/pwm-v1/': { blobs: [blob(pwm(PHOTO, 'display', REV_OLD))], hasMore: false } })

    await cleanupPhotoDerivatives({ logger: silentLogger, now: () => NOW })

    expect(prisma.photo.updateMany).toHaveBeenCalledWith({ where: { id: { in: [PHOTO] } }, data: { watermarkDisplayRevision: null } })
    expect(order).toEqual(['column', 'delete'])
  })

  it('ignores malformed objects under the pwm prefix', async () => {
    const { stats } = await sweep(photoRow(), [`derivatives/pwm-v1/${PHOTO}/display-nope.jpg`])
    expect(stats.malformedIgnored).toBe(1)
    expect(del).not.toHaveBeenCalled()
  })
})

describe('reconciliation sweep — watermark logos', () => {
  const OLD = new Date(NOW - 2 * PWM_REVISION_GRACE_MS)
  const logo = (owner, sha) => `watermarks/${owner}/${sha}.png`

  it('deletes unreferenced logos older than the grace period only', async () => {
    const referenced = logo('owner-1', 'aaaaaaaaaaaaaaaa')
    const orphan = logo('owner-1', 'bbbbbbbbbbbbbbbb')
    const fresh = logo('owner-2', 'cccccccccccccccc')
    getPrismaClient.mockResolvedValue(makePrisma({ logos: [referenced] }))
    listByPrefix({ 'watermarks/': { blobs: [blob(referenced, OLD), blob(orphan, OLD), blob(fresh, new Date(NOW - 60_000))], hasMore: false } })

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger, now: () => NOW })

    expect(deletedPaths()).toEqual([orphan])
    expect(stats.watermarkLogosDeleted).toBe(1)
  })

  it('never touches anything that is not exactly a logo pathname', async () => {
    getPrismaClient.mockResolvedValue(makePrisma())
    listByPrefix({ 'watermarks/': { blobs: [blob('watermarks/owner-1/notes.txt', OLD), blob('watermarks/x/../events/a.png', OLD)], hasMore: false } })

    const stats = await cleanupPhotoDerivatives({ logger: silentLogger, now: () => NOW })

    expect(del).not.toHaveBeenCalled()
    expect(stats.malformedIgnored).toBe(2)
  })
})
