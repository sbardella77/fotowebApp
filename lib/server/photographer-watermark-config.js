import { createHash } from 'crypto'
import { z } from 'zod'
import { resolveEffectiveEventAccessState } from '@/lib/event-access'

/**
 * Photographer watermark configuration (pure — no Prisma, no Blob, no Sharp).
 *
 * The owner configures ONE watermark at account level (OwnerWatermark row).
 * Every guest-facing image of every event of that owner is rendered with it.
 * See docs/photographer-watermark.md for the delivery contract.
 */

/**
 * Bump when the renderer's output for the SAME config changes (geometry,
 * shadow, font handling). It is hashed into every revision, so a bump
 * re-keys every photographer-watermark derivative.
 */
export const WATERMARK_RENDERER_VERSION = 'r1'
export const WATERMARK_FONT_ID = 'noto-sans-v27-latin-regular'

export const WATERMARK_TYPES = Object.freeze(['logo', 'text'])
export const WATERMARK_POSITIONS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
export const MAX_TEXT_LENGTH = 40
export const OPACITY_RANGE = Object.freeze({ min: 10, max: 100 })
export const SIZE_RANGE = Object.freeze({ min: 5, max: 50 })

const REVISION_PATTERN = /^[a-f0-9]{16}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export function isValidWatermarkRevision(value) {
  return typeof value === 'string' && REVISION_PATTERN.test(value)
}

export function isValidLogoSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

// Letters, marks, numbers, punctuation, symbols and plain spaces only.
// Excludes every control/format character (Cc, Cf — including the bidi
// overrides U+202A–202E / U+2066–2069), line/paragraph separators and
// unassigned code points.
const ALLOWED_TEXT_CHARS = /^[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u

/**
 * Normalize and validate a watermark text.
 *
 * The text is rendered as glyph outlines (photographer-watermark-render.js),
 * never as markup, so there is no injection surface — this guards against
 * invisible/direction-flipping characters and glyphs the bundled font lacks.
 *
 * @param {unknown} raw
 * @param {{ hasGlyph?: (char: string) => boolean }} [options]
 * @returns {{ ok: true, value: string } | { ok: false, code: string }}
 */
export function sanitizeWatermarkText(raw, { hasGlyph } = {}) {
  if (typeof raw !== 'string') return { ok: false, code: 'text_invalid' }
  const value = raw.normalize('NFC').replace(/[\p{Zs}]+/gu, ' ').trim()
  if (!value) return { ok: false, code: 'text_invalid' }
  if (!ALLOWED_TEXT_CHARS.test(value)) return { ok: false, code: 'text_invalid' }
  if ([...value].length > MAX_TEXT_LENGTH) return { ok: false, code: 'text_invalid' }
  if (hasGlyph) {
    for (const char of new Set(value)) {
      if (char !== ' ' && !hasGlyph(char)) return { ok: false, code: 'unsupported_character' }
    }
  }
  return { ok: true, value }
}

export const watermarkConfigSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(WATERMARK_TYPES),
  text: z.string().max(200).nullish(),
  logoSha256: z.string().regex(SHA256_PATTERN).nullish(),
  position: z.enum(WATERMARK_POSITIONS),
  opacityPercent: z.number().int().min(OPACITY_RANGE.min).max(OPACITY_RANGE.max),
  sizePercent: z.number().int().min(SIZE_RANGE.min).max(SIZE_RANGE.max),
})

/**
 * Deterministic identity of everything that affects the rendered bytes.
 * `enabled` is deliberately excluded: toggling the watermark off and on
 * again reuses the derivatives already rendered for this revision.
 *
 * @returns {string} 16 lowercase hex chars
 */
export function computeWatermarkRevision({ type, text, logoSha256, position, opacityPercent, sizePercent }) {
  const identity = JSON.stringify([
    'pwm',
    WATERMARK_RENDERER_VERSION,
    WATERMARK_FONT_ID,
    type,
    type === 'text' ? text : null,
    type === 'logo' ? logoSha256 : null,
    position,
    opacityPercent,
    sizePercent,
  ])
  return createHash('sha256').update(identity).digest('hex').slice(0, 16)
}

/** Blob pathname of an owner's logo — content-addressed, so uploads are idempotent. */
export function buildWatermarkLogoPathname(ownerId, logoSha256) {
  return `watermarks/${ownerId}/${logoSha256.slice(0, 16)}.png`
}

/** Prisma select for everything resolveActiveWatermark needs from an Owner. */
export const OWNER_WATERMARK_ACCESS_SELECT = Object.freeze({
  plan: true,
  subscriptionStatus: true,
  subscriptionGraceUntil: true,
  subscriptionCanceledAt: true,
  subscriptionCancelAtPeriodEnd: true,
  subscriptionCurrentPeriodEnd: true,
  watermark: {
    select: {
      enabled: true,
      type: true,
      text: true,
      logoUrl: true,
      logoSha256: true,
      position: true,
      opacityPercent: true,
      sizePercent: true,
      revision: true,
    },
  },
})

export function isWatermarkDeliveryKilled() {
  return process.env.PHOTOGRAPHER_WATERMARK_DELIVERY === 'off'
}

/**
 * Whether the owner's plan currently allows a custom watermark.
 * @param {object|null} owner — row selected with OWNER_WATERMARK_ACCESS_SELECT
 */
export function isOwnerWatermarkEntitled(owner) {
  if (!owner) return false
  return resolveEffectiveEventAccessState({
    billingTier: null,
    originalDownloadUnlocked: false,
    ownerPlan: owner.plan,
    subscriptionStatus: owner.subscriptionStatus,
    subscriptionGraceUntil: owner.subscriptionGraceUntil,
    subscriptionCanceledAt: owner.subscriptionCanceledAt,
    subscriptionCancelAtPeriodEnd: owner.subscriptionCancelAtPeriodEnd,
    subscriptionCurrentPeriodEnd: owner.subscriptionCurrentPeriodEnd,
  }).canUseCustomWatermark
}

/**
 * The watermark guests must receive for this owner's photos, or null.
 *
 * Null when: kill switch on, plan not entitled (lapsed subscriptions pause
 * the watermark), disabled, or the stored config is incomplete.
 *
 * @param {object|null} owner — row selected with OWNER_WATERMARK_ACCESS_SELECT
 * @returns {Readonly<{revision: string, type: 'logo'|'text', text: string|null, logoUrl: string|null, logoSha256: string|null, position: string, opacity: number, sizePercent: number}>|null}
 */
export function resolveActiveWatermark(owner) {
  if (isWatermarkDeliveryKilled()) return null
  const config = owner?.watermark
  if (!config?.enabled || !isValidWatermarkRevision(config.revision)) return null
  if (!isOwnerWatermarkEntitled(owner)) return null
  if (config.type === 'text' && !config.text) return null
  if (config.type === 'logo' && !(config.logoUrl && isValidLogoSha256(config.logoSha256))) return null
  if (!WATERMARK_TYPES.includes(config.type) || !WATERMARK_POSITIONS.includes(config.position)) return null

  return Object.freeze(buildWatermarkSpec(config))
}

/**
 * Render spec from a (validated) config. Also used for draft previews,
 * where `revision` may be null.
 */
export function buildWatermarkSpec(config) {
  return {
    revision: config.revision ?? null,
    type: config.type,
    text: config.type === 'text' ? config.text : null,
    logoUrl: config.type === 'logo' ? config.logoUrl : null,
    logoSha256: config.type === 'logo' ? config.logoSha256 : null,
    position: config.position,
    opacity: config.opacityPercent / 100,
    sizePercent: config.sizePercent,
  }
}
