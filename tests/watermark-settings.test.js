import { describe, it, expect, beforeEach, vi } from 'vitest'
import sharp from 'sharp'
import { createHash } from 'crypto'
import {
  getWatermarkSettings,
  saveWatermarkSettings,
  deleteWatermarkSettings,
  uploadWatermarkLogo,
  previewWatermark,
  MAX_LOGO_BYTES,
} from '@/lib/server/watermark-settings'
import { computeWatermarkRevision } from '@/lib/server/photographer-watermark-config'

const OWNER_ID = 'owner-1'
const LOGO_SHA = 'a'.repeat(64)
const NOW = new Date('2026-11-05T10:00:00Z')

function makePrisma(owner) {
  const state = { owner, saved: null }
  return {
    state,
    owner: { findUnique: vi.fn(async () => state.owner) },
    ownerWatermark: {
      upsert: vi.fn(async ({ create, update }) => {
        state.saved = { ...(state.owner.watermark ? { ...state.owner.watermark, ...update } : create) }
        state.saved.regenState = state.saved.regenState || 'IDLE'
        return state.saved
      }),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  }
}

function owner(overrides = {}, watermark = null) {
  return { plan: 'professional', subscriptionStatus: 'active', watermark, ...overrides }
}

const TEXT_BODY = Object.freeze({ enabled: true, type: 'text', text: '  Studio  Rossi ', position: 'bottom-right', opacityPercent: 60, sizePercent: 20 })
const headLogo = vi.fn()

beforeEach(() => {
  headLogo.mockReset().mockImplementation(async (pathname) => `https://x.public.blob.vercel-storage.com/${pathname}`)
})

async function pngDataUrl({ width = 200, height = 100, alpha = true, format = 'png' } = {}) {
  const channels = alpha ? 4 : 3
  const background = alpha ? { r: 255, g: 255, b: 255, alpha: 0.5 } : { r: 255, g: 255, b: 255 }
  let pipeline = sharp({ create: { width, height, channels, background } })
  pipeline = format === 'png' ? pipeline.png() : pipeline.jpeg()
  const buffer = await pipeline.toBuffer()
  return `data:image/png;base64,${buffer.toString('base64')}`
}

describe('getWatermarkSettings', () => {
  it('defaults for an owner without a watermark', async () => {
    const result = await getWatermarkSettings({ prisma: makePrisma(owner()), ownerId: OWNER_ID })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ entitled: true, paused: false, regenState: 'IDLE', config: { enabled: false, type: 'text' } })
  })

  it('reports paused when the plan lapsed with an enabled watermark', async () => {
    const wm = { enabled: true, type: 'text', text: 'S', position: 'center', opacityPercent: 50, sizePercent: 20, regenState: 'IDLE' }
    const result = await getWatermarkSettings({ prisma: makePrisma(owner({ subscriptionStatus: 'canceled' }, wm)), ownerId: OWNER_ID })
    expect(result.body).toMatchObject({ entitled: false, paused: true })
  })

  it('never returns internal fields', async () => {
    const wm = { enabled: true, type: 'text', text: 'S', position: 'center', opacityPercent: 50, sizePercent: 20, revision: 'x', logoPathname: 'watermarks/o/x.png', regenState: 'IDLE' }
    const { body } = await getWatermarkSettings({ prisma: makePrisma(owner({}, wm)), ownerId: OWNER_ID })
    expect(body.config).not.toHaveProperty('revision')
    expect(body.config).not.toHaveProperty('logoPathname')
  })
})

describe('saveWatermarkSettings', () => {
  it('403 when not entitled', async () => {
    const result = await saveWatermarkSettings({ prisma: makePrisma(owner({ plan: 'free' })), ownerId: OWNER_ID, body: TEXT_BODY, headLogo })
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('watermark_not_entitled')
  })

  it('saves a sanitized text config with its revision and queues regeneration', async () => {
    const prisma = makePrisma(owner())
    const result = await saveWatermarkSettings({ prisma, ownerId: OWNER_ID, body: TEXT_BODY, headLogo, now: () => NOW })
    expect(result.status).toBe(200)
    const { create } = prisma.ownerWatermark.upsert.mock.calls[0][0]
    expect(create).toMatchObject({
      ownerId: OWNER_ID,
      text: 'Studio Rossi',
      logoSha256: null,
      revision: computeWatermarkRevision({ ...TEXT_BODY, text: 'Studio Rossi' }),
      revisionChangedAt: NOW,
      regenState: 'PENDING',
      regenRequestedAt: NOW,
    })
  })

  it('same config again → no revision change, no regeneration', async () => {
    const revision = computeWatermarkRevision({ ...TEXT_BODY, text: 'Studio Rossi' })
    const prisma = makePrisma(owner({}, { enabled: true, revision, regenState: 'IDLE' }))
    await saveWatermarkSettings({ prisma, ownerId: OWNER_ID, body: TEXT_BODY, headLogo, now: () => NOW })
    const { update } = prisma.ownerWatermark.upsert.mock.calls[0][0]
    expect(update).not.toHaveProperty('revisionChangedAt')
    expect(update).not.toHaveProperty('regenState')
  })

  it('switching on an unchanged config queues regeneration', async () => {
    const revision = computeWatermarkRevision({ ...TEXT_BODY, text: 'Studio Rossi' })
    const prisma = makePrisma(owner({}, { enabled: false, revision, regenState: 'IDLE' }))
    await saveWatermarkSettings({ prisma, ownerId: OWNER_ID, body: TEXT_BODY, headLogo, now: () => NOW })
    expect(prisma.ownerWatermark.upsert.mock.calls[0][0].update).toMatchObject({ regenState: 'PENDING' })
  })

  it('saving disabled never queues regeneration', async () => {
    const prisma = makePrisma(owner())
    await saveWatermarkSettings({ prisma, ownerId: OWNER_ID, body: { ...TEXT_BODY, enabled: false }, headLogo, now: () => NOW })
    expect(prisma.ownerWatermark.upsert.mock.calls[0][0].create).not.toHaveProperty('regenState')
  })

  it.each([
    ['invalid text', { text: 'a‮b' }, 'text_invalid'],
    ['glyph missing from the font', { text: 'Studio 漢' }, 'unsupported_character'],
    ['out of range opacity', { opacityPercent: 0 }, 'settings_invalid'],
  ])('400 on %s', async (_label, change, code) => {
    const result = await saveWatermarkSettings({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { ...TEXT_BODY, ...change }, headLogo })
    expect(result).toMatchObject({ status: 400, body: { code } })
  })

  it('logo: resolves the URL only under this owner\'s prefix', async () => {
    const prisma = makePrisma(owner())
    const body = { ...TEXT_BODY, type: 'logo', text: null, logoSha256: LOGO_SHA }
    await saveWatermarkSettings({ prisma, ownerId: OWNER_ID, body, headLogo })
    expect(headLogo).toHaveBeenCalledWith(`watermarks/${OWNER_ID}/${'a'.repeat(16)}.png`)
    expect(prisma.ownerWatermark.upsert.mock.calls[0][0].create).toMatchObject({ type: 'logo', text: null, logoSha256: LOGO_SHA, logoPathname: `watermarks/${OWNER_ID}/${'a'.repeat(16)}.png` })
  })

  it('logo not uploaded (or another owner\'s) → 400 logo_missing', async () => {
    headLogo.mockResolvedValue(null)
    const result = await saveWatermarkSettings({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { ...TEXT_BODY, type: 'logo', logoSha256: LOGO_SHA }, headLogo })
    expect(result).toMatchObject({ status: 400, body: { code: 'logo_missing' } })
  })
})

describe('deleteWatermarkSettings', () => {
  it('deletes the owner\'s row, even without entitlement', async () => {
    const prisma = makePrisma(owner({ plan: 'free' }))
    const result = await deleteWatermarkSettings({ prisma, ownerId: OWNER_ID })
    expect(result.status).toBe(200)
    expect(prisma.ownerWatermark.deleteMany).toHaveBeenCalledWith({ where: { ownerId: OWNER_ID } })
  })
})

describe('uploadWatermarkLogo', () => {
  const putLogo = vi.fn(async (pathname) => ({ url: `https://x.public.blob.vercel-storage.com/${pathname}` }))

  beforeEach(() => putLogo.mockClear())

  it('stores a re-encoded transparent PNG under a content-addressed path', async () => {
    const result = await uploadWatermarkLogo({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { logoDataUrl: await pngDataUrl() }, putLogo })
    expect(result.status).toBe(200)
    const [pathname, stored] = putLogo.mock.calls[0]
    const sha = createHash('sha256').update(stored).digest('hex')
    expect(result.body.logoSha256).toBe(sha)
    expect(pathname).toBe(`watermarks/${OWNER_ID}/${sha.slice(0, 16)}.png`)
    expect((await sharp(stored).metadata()).format).toBe('png')
  })

  it('downscales very large logos to 1200px', async () => {
    const result = await uploadWatermarkLogo({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { logoDataUrl: await pngDataUrl({ width: 3000, height: 600 }) }, putLogo })
    expect(result.body).toMatchObject({ width: 1200, height: 240 })
  })

  it('403 when not entitled', async () => {
    const result = await uploadWatermarkLogo({ prisma: makePrisma(owner({ plan: 'free' })), ownerId: OWNER_ID, body: { logoDataUrl: await pngDataUrl() }, putLogo })
    expect(result.status).toBe(403)
    expect(putLogo).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-PNG data URL', async () => 'data:image/svg+xml;base64,PHN2Zz4=', 'logo_file_type'],
    ['JPEG bytes labelled as PNG', () => pngDataUrl({ format: 'jpeg', alpha: false }), 'logo_file_type'],
    ['no transparency', () => pngDataUrl({ alpha: false }), 'logo_not_transparent'],
    ['too small', () => pngDataUrl({ width: 63, height: 63 }), 'logo_dimensions'],
    ['missing body', async () => undefined, 'logo_file_type'],
  ])('rejects %s', async (_label, makeDataUrl, code) => {
    const result = await uploadWatermarkLogo({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { logoDataUrl: await makeDataUrl() }, putLogo })
    expect(result).toMatchObject({ status: 400, body: { code } })
    expect(putLogo).not.toHaveBeenCalled()
  })

  it('rejects files over 2 MB', async () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_LOGO_BYTES + 1).toString('base64')}`
    const result = await uploadWatermarkLogo({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { logoDataUrl: oversized }, putLogo })
    expect(result.body.code).toBe('logo_too_large')
  })
})

describe('previewWatermark', () => {
  it('renders the draft spec with the requested sample', async () => {
    const render = vi.fn(async () => Buffer.from('jpeg'))
    const result = await previewWatermark({ prisma: makePrisma(owner()), ownerId: OWNER_ID, body: { ...TEXT_BODY, enabled: false, sample: 'portrait' }, headLogo, render })
    expect(result.status).toBe(200)
    expect(result.image.toString()).toBe('jpeg')
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ type: 'text', text: 'Studio Rossi', opacity: 0.6 }), { sample: 'portrait' })
  })

  it('403 when not entitled', async () => {
    const result = await previewWatermark({ prisma: makePrisma(owner({ plan: 'free' })), ownerId: OWNER_ID, body: TEXT_BODY, headLogo })
    expect(result.status).toBe(403)
  })
})
