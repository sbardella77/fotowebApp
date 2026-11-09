import sharp from 'sharp'
import { createHash } from 'crypto'
import {
  OWNER_WATERMARK_ACCESS_SELECT,
  buildWatermarkLogoPathname,
  buildWatermarkSpec,
  computeWatermarkRevision,
  isOwnerWatermarkEntitled,
  sanitizeWatermarkText,
  watermarkConfigSchema,
} from '@/lib/server/photographer-watermark-config'
import { fontHasGlyph, renderWatermarkPreview } from '@/lib/server/photographer-watermark-render'

/**
 * Owner-facing photographer watermark settings (GET/PATCH/DELETE config, logo
 * upload, preview). Pure handlers over injected dependencies; the catch-all
 * API route does authentication, CSRF and rate limiting before calling them.
 *
 * Every handler returns `{ status, body }` (or `{ status, image }` for the
 * preview). Errors carry a stable `code` the dashboard maps to copy.
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const LOGO_MIN_DIMENSION = 64
export const LOGO_MAX_DIMENSION = 4000
const LOGO_STORED_MAX_DIMENSION = 1200
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  type: 'text',
  text: '',
  logoSha256: null,
  logoUrl: null,
  position: 'bottom-right',
  opacityPercent: 60,
  sizePercent: 20,
})

const notEntitled = () => ({ status: 403, body: { error: 'Custom watermark requires a Professional or Business plan', code: 'watermark_not_entitled', upgradePath: 'professional' } })
const invalid = (code, error = 'Invalid watermark settings') => ({ status: 400, body: { error, code } })

async function loadOwnerWithWatermark(prisma, ownerId) {
  return prisma.owner.findUnique({
    where: { id: ownerId },
    select: {
      ...OWNER_WATERMARK_ACCESS_SELECT,
      watermark: { select: { ...OWNER_WATERMARK_ACCESS_SELECT.watermark.select, logoPathname: true, regenState: true } },
    },
  })
}

function toClientConfig(watermark) {
  if (!watermark) return null
  return {
    enabled: watermark.enabled,
    type: watermark.type,
    text: watermark.text || '',
    logoSha256: watermark.logoSha256 || null,
    logoUrl: watermark.logoUrl || null,
    position: watermark.position,
    opacityPercent: watermark.opacityPercent,
    sizePercent: watermark.sizePercent,
  }
}

/** GET — current settings plus entitlement state. */
export async function getWatermarkSettings({ prisma, ownerId }) {
  const owner = await loadOwnerWithWatermark(prisma, ownerId)
  if (!owner) return { status: 404, body: { error: 'Owner not found' } }
  const entitled = isOwnerWatermarkEntitled(owner)
  const config = toClientConfig(owner.watermark)
  return {
    status: 200,
    body: {
      entitled,
      // A saved, enabled watermark that is not applied because the plan lapsed.
      paused: !entitled && !!config?.enabled,
      config: config || { ...DEFAULT_CONFIG },
      regenState: owner.watermark?.regenState || 'IDLE',
    },
  }
}

/**
 * Validate a draft config from the client. For a logo, resolves the logo URL
 * from this owner's own content-addressed prefix — a hash uploaded by
 * another owner never resolves here.
 *
 * @returns {Promise<{ok: true, config: object} | {ok: false, response: object}>}
 */
async function validateDraft({ ownerId, body, headLogo }) {
  const parsed = watermarkConfigSchema.safeParse(body)
  if (!parsed.success) return { ok: false, response: invalid('settings_invalid') }
  const draft = parsed.data

  if (draft.type === 'text') {
    const text = sanitizeWatermarkText(draft.text, { hasGlyph: fontHasGlyph })
    if (!text.ok) return { ok: false, response: invalid(text.code, 'Invalid watermark text') }
    return { ok: true, config: { ...draft, text: text.value, logoSha256: null, logoUrl: null, logoPathname: null } }
  }

  if (!draft.logoSha256) return { ok: false, response: invalid('logo_missing', 'Upload a logo first') }
  const logoPathname = buildWatermarkLogoPathname(ownerId, draft.logoSha256)
  const logoUrl = await headLogo(logoPathname)
  if (!logoUrl) return { ok: false, response: invalid('logo_missing', 'Upload a logo first') }
  return { ok: true, config: { ...draft, text: null, logoUrl, logoPathname } }
}

/**
 * PATCH — save the config. Recomputes the revision; when it changes (or the
 * watermark is switched on), existing photos are queued for regeneration.
 *
 * @param {object} deps
 * @param {(pathname: string) => Promise<string|null>} deps.headLogo  public URL of an existing logo blob, or null
 * @param {() => Date} [deps.now]
 */
export async function saveWatermarkSettings({ prisma, ownerId, body, headLogo, now = () => new Date() }) {
  const owner = await loadOwnerWithWatermark(prisma, ownerId)
  if (!owner) return { status: 404, body: { error: 'Owner not found' } }
  if (!isOwnerWatermarkEntitled(owner)) return notEntitled()

  const validated = await validateDraft({ ownerId, body, headLogo })
  if (!validated.ok) return validated.response
  const { enabled, type, text, logoSha256, logoUrl, logoPathname, position, opacityPercent, sizePercent } = validated.config

  const revision = computeWatermarkRevision({ type, text, logoSha256, position, opacityPercent, sizePercent })
  const previous = owner.watermark
  const revisionChanged = previous?.revision !== revision
  const switchedOn = enabled && !previous?.enabled
  const timestamp = now()

  const data = {
    enabled,
    type,
    text,
    logoSha256,
    logoUrl,
    logoPathname,
    position,
    opacityPercent,
    sizePercent,
    revision,
    ...(revisionChanged ? { revisionChangedAt: timestamp } : {}),
    ...(enabled && (revisionChanged || switchedOn) ? { regenState: 'PENDING', regenRequestedAt: timestamp } : {}),
  }

  const saved = await prisma.ownerWatermark.upsert({
    where: { ownerId },
    create: { ownerId, ...data },
    update: data,
  })

  return {
    status: 200,
    body: { entitled: true, paused: false, config: toClientConfig(saved), regenState: saved.regenState },
  }
}

/**
 * DELETE — remove the watermark. Allowed even after the plan lapsed, so an
 * owner can always clear it. The logo blob and rendered derivatives are
 * reclaimed by the cleanup sweep (never deleted inline: an in-flight ZIP may
 * still be rendering with them).
 */
export async function deleteWatermarkSettings({ prisma, ownerId }) {
  await prisma.ownerWatermark.deleteMany({ where: { ownerId } })
  return { status: 200, body: { deleted: true } }
}

/**
 * POST logo — validate and store a transparent PNG logo. Returns its hash and
 * URL; does not change the saved config (the client saves it with PATCH).
 *
 * @param {object} deps
 * @param {(pathname: string, buffer: Buffer) => Promise<{url: string}>} deps.putLogo
 */
export async function uploadWatermarkLogo({ prisma, ownerId, body, putLogo }) {
  const owner = await loadOwnerWithWatermark(prisma, ownerId)
  if (!owner) return { status: 404, body: { error: 'Owner not found' } }
  if (!isOwnerWatermarkEntitled(owner)) return notEntitled()

  const match = typeof body?.logoDataUrl === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.logoDataUrl) : null
  if (!match) return invalid('logo_file_type', 'The logo must be a PNG image')
  const buffer = Buffer.from(match[1], 'base64')
  if (buffer.length > MAX_LOGO_BYTES) return invalid('logo_too_large', 'The logo must be 2 MB or smaller')
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return invalid('logo_file_type', 'The logo must be a PNG image')
  }

  let metadata
  try {
    metadata = await sharp(buffer, { limitInputPixels: LOGO_MAX_DIMENSION * LOGO_MAX_DIMENSION }).metadata()
  } catch {
    return invalid('logo_file_type', 'The logo could not be read as a PNG image')
  }
  if (metadata.format !== 'png' || (metadata.pages && metadata.pages > 1)) {
    return invalid('logo_file_type', 'The logo must be a still PNG image')
  }
  const { width = 0, height = 0 } = metadata
  if (Math.min(width, height) < LOGO_MIN_DIMENSION || Math.max(width, height) > LOGO_MAX_DIMENSION) {
    return invalid('logo_dimensions', `The logo must be between ${LOGO_MIN_DIMENSION} and ${LOGO_MAX_DIMENSION} pixels per side`)
  }
  if (!metadata.hasAlpha) return invalid('logo_not_transparent', 'The logo must have a transparent background')

  // Re-encode: drops every ancillary chunk (text, XMP, EXIF) and bounds the
  // stored size. The stored bytes are what the hash and renderer use.
  const stored = await sharp(buffer)
    .resize(LOGO_STORED_MAX_DIMENSION, LOGO_STORED_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true })
  const logoSha256 = createHash('sha256').update(stored.data).digest('hex')
  const { url } = await putLogo(buildWatermarkLogoPathname(ownerId, logoSha256), stored.data)

  return { status: 200, body: { logoSha256, logoUrl: url, width: stored.info.width, height: stored.info.height } }
}

/** POST preview — render a draft config on a neutral sample. */
export async function previewWatermark({ prisma, ownerId, body, headLogo, render = renderWatermarkPreview }) {
  const owner = await loadOwnerWithWatermark(prisma, ownerId)
  if (!owner) return { status: 404, body: { error: 'Owner not found' } }
  if (!isOwnerWatermarkEntitled(owner)) return notEntitled()

  const validated = await validateDraft({ ownerId, body: { ...body, enabled: true }, headLogo })
  if (!validated.ok) return validated.response
  const sample = body?.sample === 'portrait' ? 'portrait' : 'landscape'
  const image = await render(buildWatermarkSpec(validated.config), { sample })
  return { status: 200, image }
}
