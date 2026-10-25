import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Minimal Mux Video REST client (no SDK dependency).
 *
 * Mux is the only place room videos are stored or served from. Every
 * rendition guests receive (the MP4 static rendition and the thumbnail) is
 * re-encoded by Mux, so container metadata such as GPS location from the
 * phone's original file never reaches a browser — the video counterpart of
 * the sharp-based EXIF-safe display derivative for images.
 */

const MUX_API_BASE = 'https://api.mux.com'
const WEBHOOK_TOLERANCE_SECONDS = 300
const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9]{10,80}$/

export class MuxConfigError extends Error {}

export function isMuxConfigured() {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET)
}

async function muxRequest(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  if (!isMuxConfigured()) throw new MuxConfigError('MUX_TOKEN_ID / MUX_TOKEN_SECRET are not configured')
  const auth = Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString('base64')
  const response = await fetchImpl(`${MUX_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (method === 'DELETE' && (response.status === 204 || response.status === 404)) return null
  if (!response.ok) {
    // Status only — Mux error bodies can echo request data.
    throw new Error(`Mux ${method} ${path.split('/').slice(0, 4).join('/')} failed: ${response.status}`)
  }
  const json = await response.json()
  return json.data
}

/**
 * Creates a one-shot direct upload URL the browser PUTs the file to.
 * `passthrough` carries our Photo.id, scoped to the deployment environment
 * (see buildPassthrough), so webhooks can be matched back.
 */
export function createDirectUpload({ photoId, corsOrigin, fetchImpl }) {
  return muxRequest('/video/v1/uploads', {
    method: 'POST',
    fetchImpl,
    body: {
      cors_origin: corsOrigin,
      timeout: 3600,
      new_asset_settings: {
        playback_policies: ['public'],
        video_quality: 'basic',
        max_resolution_tier: '1080p',
        static_renditions: [{ resolution: 'highest' }],
        passthrough: buildPassthrough(photoId),
      },
    },
  })
}

/**
 * Which deployment environment owns an upload. Preview and production may
 * share one Mux environment (and so receive each other's webhooks); each
 * must only ever act on its own assets — a preview deployment once treated
 * a production video as an orphan (absent from ITS database) and deleted it.
 */
export function getMuxScope() {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
}

export function buildPassthrough(photoId, scope = getMuxScope()) {
  return `${scope}:${photoId}`
}

/**
 * @returns {{ scope: string|null, photoId: string|null }} scope is null for
 *   legacy passthroughs (bare photo id) created before scoping existed.
 */
export function parsePassthrough(passthrough) {
  if (typeof passthrough !== 'string' || !passthrough) return { scope: null, photoId: null }
  const index = passthrough.lastIndexOf(':')
  if (index === -1) return { scope: null, photoId: passthrough }
  return { scope: passthrough.slice(0, index), photoId: passthrough.slice(index + 1) || null }
}

export function getAsset(assetId, { fetchImpl } = {}) {
  return muxRequest(`/video/v1/assets/${encodeURIComponent(assetId)}`, { fetchImpl })
}

export function deleteAsset(assetId, { fetchImpl } = {}) {
  return muxRequest(`/video/v1/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE', fetchImpl })
}

/**
 * True once the MP4 static rendition can be served. Handles both the
 * current per-file shape (`static_renditions.files[].status`) and the legacy
 * aggregate shape (`static_renditions.status`).
 */
export function isStaticRenditionReady(asset) {
  const renditions = asset?.static_renditions
  if (!renditions) return false
  if (Array.isArray(renditions.files) && renditions.files.length > 0) {
    return renditions.files.some((file) => file?.status === 'ready')
  }
  return renditions.status === 'ready'
}

export function getPublicPlaybackId(asset) {
  const id = (asset?.playback_ids || []).find((p) => p?.policy === 'public')?.id
  return typeof id === 'string' && PLAYBACK_ID_PATTERN.test(id) ? id : null
}

export function buildVideoUrl(playbackId) {
  return `https://stream.mux.com/${playbackId}/highest.mp4`
}

// HLS is playable as soon as the asset is `ready` — well before the MP4
// static rendition — so it is the fast path for browsers with native HLS.
export function buildHlsUrl(playbackId) {
  return `https://stream.mux.com/${playbackId}.m3u8`
}

export function buildPosterUrl(playbackId) {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?width=640&fit_mode=preserve`
}

/**
 * Verifies the `mux-signature` header (`t=<unix>,v1=<hex hmac>`) over the
 * RAW request body. Fails closed when the secret is missing.
 */
export function verifyMuxWebhookSignature(rawBody, header, { secret = process.env.MUX_WEBHOOK_SECRET, now = Date.now() } = {}) {
  if (!secret || typeof header !== 'string') return false
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const index = part.indexOf('=')
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()]
    })
  )
  const timestamp = Number(parts.t)
  if (!Number.isFinite(timestamp) || !parts.v1) return false
  if (Math.abs(now / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1)
  return a.length === b.length && timingSafeEqual(a, b)
}
