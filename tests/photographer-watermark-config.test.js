import { describe, it, expect, afterEach } from 'vitest'
import {
  computeWatermarkRevision,
  sanitizeWatermarkText,
  watermarkConfigSchema,
  resolveActiveWatermark,
  isOwnerWatermarkEntitled,
  buildWatermarkLogoPathname,
  isValidWatermarkRevision,
  MAX_TEXT_LENGTH,
} from '@/lib/server/photographer-watermark-config'

const BASE_CONFIG = Object.freeze({
  type: 'text',
  text: 'Studio Rossi',
  logoSha256: null,
  position: 'bottom-right',
  opacityPercent: 60,
  sizePercent: 20,
})

const LOGO_SHA = 'c'.repeat(64)

function makeOwner(overrides = {}, watermarkOverrides = {}) {
  const watermark = {
    enabled: true,
    ...BASE_CONFIG,
    logoUrl: null,
    ...watermarkOverrides,
  }
  watermark.revision = watermarkOverrides.revision ?? computeWatermarkRevision(watermark)
  return {
    plan: 'professional',
    subscriptionStatus: 'active',
    subscriptionGraceUntil: null,
    subscriptionCanceledAt: null,
    subscriptionCancelAtPeriodEnd: false,
    subscriptionCurrentPeriodEnd: null,
    watermark,
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.PHOTOGRAPHER_WATERMARK_DELIVERY
})

describe('computeWatermarkRevision', () => {
  it('is deterministic 16-char hex', () => {
    const revision = computeWatermarkRevision(BASE_CONFIG)
    expect(revision).toBe(computeWatermarkRevision({ ...BASE_CONFIG }))
    expect(isValidWatermarkRevision(revision)).toBe(true)
  })

  it.each([
    ['text', { text: 'Studio Bianchi' }],
    ['position', { position: 'top-left' }],
    ['opacity', { opacityPercent: 61 }],
    ['size', { sizePercent: 21 }],
    ['type', { type: 'logo', logoSha256: LOGO_SHA }],
  ])('changes when %s changes', (_label, change) => {
    expect(computeWatermarkRevision({ ...BASE_CONFIG, ...change })).not.toBe(computeWatermarkRevision(BASE_CONFIG))
  })

  it('changes when the logo bytes change', () => {
    const logo = { ...BASE_CONFIG, type: 'logo', text: null, logoSha256: LOGO_SHA }
    expect(computeWatermarkRevision({ ...logo, logoSha256: 'd'.repeat(64) })).not.toBe(computeWatermarkRevision(logo))
  })

  it('ignores enabled and the fields of the inactive type', () => {
    expect(computeWatermarkRevision({ ...BASE_CONFIG, enabled: false })).toBe(computeWatermarkRevision({ ...BASE_CONFIG, enabled: true }))
    expect(computeWatermarkRevision({ ...BASE_CONFIG, logoSha256: LOGO_SHA })).toBe(computeWatermarkRevision(BASE_CONFIG))
  })
})

describe('sanitizeWatermarkText', () => {
  it('trims, collapses spaces and NFC-normalizes', () => {
    expect(sanitizeWatermarkText('  Studio   Foto  ')).toEqual({ ok: true, value: 'Studio Foto' })
    expect(sanitizeWatermarkText('Café')).toEqual({ ok: true, value: 'Café' })
  })

  it('accepts markup characters as literal glyphs', () => {
    expect(sanitizeWatermarkText('<b>Rossi</b> & Co')).toEqual({ ok: true, value: '<b>Rossi</b> & Co' })
  })

  it.each([
    ['empty', '   '],
    ['newline', 'Studio\nRossi'],
    ['control char', 'Studio\u0007'],
    ['bidi override', 'Studio‮Rossi'],
    ['zero-width joiner', 'Studio‍Rossi'],
    ['too long', 'x'.repeat(MAX_TEXT_LENGTH + 1)],
    ['not a string', 42],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeWatermarkText(value)).toEqual({ ok: false, code: 'text_invalid' })
  })

  it('rejects characters the font cannot draw', () => {
    const hasGlyph = (char) => char !== '漢'
    expect(sanitizeWatermarkText('Studio 漢', { hasGlyph })).toEqual({ ok: false, code: 'unsupported_character' })
    expect(sanitizeWatermarkText('Studio', { hasGlyph })).toEqual({ ok: true, value: 'Studio' })
  })
})

describe('watermarkConfigSchema', () => {
  const valid = { enabled: true, ...BASE_CONFIG }

  it('accepts a valid config', () => {
    expect(watermarkConfigSchema.safeParse(valid).success).toBe(true)
  })

  it.each([
    ['opacity below range', { opacityPercent: 9 }],
    ['opacity above range', { opacityPercent: 101 }],
    ['size below range', { sizePercent: 4 }],
    ['size above range', { sizePercent: 51 }],
    ['unknown position', { position: 'middle' }],
    ['unknown type', { type: 'svg' }],
    ['malformed logo hash', { logoSha256: 'xyz' }],
  ])('rejects %s', (_label, change) => {
    expect(watermarkConfigSchema.safeParse({ ...valid, ...change }).success).toBe(false)
  })
})

describe('isOwnerWatermarkEntitled', () => {
  const now = Date.now()
  it.each([
    ['professional active', { plan: 'professional' }, true],
    ['business active', { plan: 'business' }, true],
    ['legacy pro', { plan: 'pro' }, true],
    ['free', { plan: 'free' }, false],
    ['canceled', { subscriptionStatus: 'canceled' }, false],
    ['past_due within grace', { subscriptionStatus: 'past_due', subscriptionGraceUntil: new Date(now + 86_400_000) }, true],
    ['past_due after grace', { subscriptionStatus: 'past_due', subscriptionGraceUntil: new Date(now - 86_400_000) }, false],
    ['cancellation scheduled, period not over', { subscriptionCancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: new Date(now + 86_400_000) }, true],
    ['cancellation scheduled, period over', { subscriptionCancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: new Date(now - 86_400_000) }, false],
  ])('%s → %s', (_label, overrides, expected) => {
    expect(isOwnerWatermarkEntitled(makeOwner(overrides))).toBe(expected)
  })

  it('null owner is never entitled', () => {
    expect(isOwnerWatermarkEntitled(null)).toBe(false)
  })
})

describe('resolveActiveWatermark', () => {
  it('returns a frozen spec for an entitled, enabled, complete config', () => {
    const owner = makeOwner()
    const spec = resolveActiveWatermark(owner)
    expect(spec).toEqual({
      revision: owner.watermark.revision,
      type: 'text',
      text: 'Studio Rossi',
      logoUrl: null,
      logoSha256: null,
      position: 'bottom-right',
      opacity: 0.6,
      sizePercent: 20,
    })
    expect(Object.isFrozen(spec)).toBe(true)
  })

  it('returns a logo spec when the logo is complete', () => {
    const spec = resolveActiveWatermark(makeOwner({}, { type: 'logo', text: null, logoSha256: LOGO_SHA, logoUrl: 'https://x.public.blob.vercel-storage.com/watermarks/o/c.png' }))
    expect(spec).toMatchObject({ type: 'logo', text: null, logoSha256: LOGO_SHA })
  })

  it.each([
    ['no watermark row', makeOwner({ watermark: null })],
    ['disabled', makeOwner({}, { enabled: false })],
    ['not entitled', makeOwner({ plan: 'free' })],
    ['lapsed subscription', makeOwner({ subscriptionStatus: 'canceled' })],
    ['missing text', makeOwner({}, { text: null })],
    ['logo without url', makeOwner({}, { type: 'logo', text: null, logoSha256: LOGO_SHA, logoUrl: null })],
    ['invalid revision', makeOwner({}, { revision: 'nope' })],
  ])('null when %s', (_label, owner) => {
    expect(resolveActiveWatermark(owner)).toBeNull()
  })

  it('null when the kill switch is set', () => {
    process.env.PHOTOGRAPHER_WATERMARK_DELIVERY = 'off'
    expect(resolveActiveWatermark(makeOwner())).toBeNull()
  })
})

describe('buildWatermarkLogoPathname', () => {
  it('is content-addressed under the owner prefix', () => {
    expect(buildWatermarkLogoPathname('owner-1', LOGO_SHA)).toBe(`watermarks/owner-1/${'c'.repeat(16)}.png`)
  })
})
