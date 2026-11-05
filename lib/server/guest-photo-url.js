import { buildDisplayDerivativePath } from '@/lib/server/display-derivative'
import { buildPwmDisplayPath } from '@/lib/server/photographer-watermark-derivative'

/**
 * Guest-safe photo URL resolution (TASK-03 Phase 1A — plumbing only).
 *
 * This module is NOT wired into the public Photo DTO yet
 * (lib/server/repository-mappers.js still exposes the original `url`).
 * It exists so the eventual cutover is a DTO change plus a call to
 * resolveGuestPhotoUrl(), not a redesign.
 *
 * Fail-closed by construction: resolveGuestPhotoUrl() takes ONLY
 * `{ id, displayDerivativeStatus }` — it is never handed `photo.url`, so
 * there is no original value anywhere in this module's scope that could
 * accidentally be returned. There is exactly one branch that returns a
 * non-null URL (status === 'READY'); every other input, and any
 * misconfiguration of the derivative origin, returns null.
 */

/**
 * Expected shape of the display-derivative Blob store's public origin:
 * https://<store-id>.public.blob.vercel-storage.com — no path, no
 * trailing slash, no credentials, no port, no query/fragment.
 */
const DISPLAY_BLOB_ORIGIN_PATTERN = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com$/

/**
 * Read and validate the display-derivative Blob origin from its one
 * authoritative configuration source: the DISPLAY_DERIVATIVE_BLOB_ORIGIN
 * environment variable.
 *
 * Deliberately NOT derived from any historical Photo.url value — that
 * would make correctness depend on at least one row already existing
 * with a well-formed URL, and would silently break if the store were
 * ever migrated in a way where old rows point elsewhere. This is a
 * single, explicit, server-controlled constant instead: same value for
 * every photo, independent of data.
 *
 * Carries no credential — a Blob store's public origin is not a secret
 * (the whole point of `access: 'public'` derivatives is that the origin
 * is meant to be reachable by any browser).
 *
 * @returns {string} the validated origin
 * @throws {Error} if the env var is missing or does not match the
 *   expected origin shape. Never throws WITH the invalid value in the
 *   message beyond what's needed to diagnose a config typo — there is no
 *   secret to redact here, but no upstream caller should assume the
 *   value is safe to log verbatim without knowing that.
 */
export function getDisplayDerivativeOrigin() {
  const origin = process.env.DISPLAY_DERIVATIVE_BLOB_ORIGIN
  if (!origin || typeof origin !== 'string' || !DISPLAY_BLOB_ORIGIN_PATTERN.test(origin)) {
    throw new Error('DISPLAY_DERIVATIVE_BLOB_ORIGIN is missing or is not a valid *.public.blob.vercel-storage.com origin')
  }
  return origin
}

/**
 * True only if getDisplayDerivativeOrigin() would succeed right now.
 * Intended for startup/health-check style validation — NOT called by
 * resolveGuestPhotoUrl() itself, which fails closed per-call instead
 * (see below) so one misconfigured deploy degrades to placeholders
 * rather than throwing out of every gallery request.
 */
export function isDisplayDerivativeOriginConfigured() {
  try {
    getDisplayDerivativeOrigin()
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the guest-safe URL for a photo, or null.
 *
 * READY is the ONLY status that can ever produce a non-null return —
 * every other status (PENDING, FAILED, LEGACY_UNVERIFIED), and any
 * origin-configuration failure, returns null. There is intentionally no
 * fallback branch of any kind: this function does not accept `photo.url`
 * as an input, so there is no original value in scope to fall back to
 * even if someone tried to add one later without changing the signature.
 *
 * Photographer watermark: when the event owner has an active watermark
 * (`options.watermark`, a spec from resolveActiveWatermark), the clean
 * display-v1 rendition is NEVER returned. The watermarked display derivative
 * is returned when the photo's recorded revision matches; otherwise the
 * same-origin lazy media route, which renders it on first request.
 *
 * @param {{id: string, displayDerivativeStatus: string, watermarkDisplayRevision?: string|null}} photo
 * @param {{watermark?: {revision: string}|null}} [options]
 * @returns {string|null}
 */
export function resolveGuestPhotoUrl(photo, { watermark = null } = {}) {
  if (!photo || photo.displayDerivativeStatus !== 'READY') {
    return null
  }

  let origin
  try {
    origin = getDisplayDerivativeOrigin()
  } catch (error) {
    // Fail closed: a misconfigured origin must degrade to "no image
    // shown," never to "show something else instead." Logged once per
    // call rather than crashing the caller's response — a broken
    // deploy-time config is an ops problem to notice from logs, not a
    // reason to 500 every gallery page.
    console.warn('[resolveGuestPhotoUrl] derivative origin misconfigured:', error.message)
    return null
  }

  if (watermark) {
    try {
      if (photo.watermarkDisplayRevision === watermark.revision) {
        return `${origin}/${buildPwmDisplayPath(photo.id, watermark)}`
      }
      return buildLazyWatermarkDisplayUrl(photo.id, watermark)
    } catch (error) {
      // Invalid id/revision: fail closed, never fall back to display-v1.
      console.warn('[resolveGuestPhotoUrl] watermark url unavailable:', error.message)
      return null
    }
  }

  return `${origin}/${buildDisplayDerivativePath(photo.id)}`
}

/**
 * Same-origin route that renders the watermarked display derivative on
 * first request and redirects to it (app/api/media/photos/[photoId]/display).
 * The revision is part of the URL so a browser/CDN cache entry can never
 * outlive a watermark change.
 */
export function buildLazyWatermarkDisplayUrl(photoId, watermark) {
  // Validates id and revision exactly like the derivative path does.
  buildPwmDisplayPath(photoId, watermark)
  return `/api/media/photos/${photoId}/display?r=${watermark.revision}`
}
