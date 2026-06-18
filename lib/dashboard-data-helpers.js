/**
 * SnapRooms — Dashboard data-loading safety helpers.
 *
 * These helpers are pure and environment-agnostic so they can be unit tested
 * without a browser or React runtime.
 */

/**
 * Safely parse a fetch Response as JSON.
 *
 * Returns `{ ok, status, payload }` so callers can handle HTTP errors and
 * malformed bodies without throwing. Empty or non-JSON bodies fall back to
 * the provided `fallback` value (default `{}`).
 *
 * @param {Response} response
 * @param {{ fallback?: unknown }} [options]
 * @returns {Promise<{ ok: boolean; status: number; payload: unknown }>}
 */
export async function safeFetchJson(response, { fallback = {} } = {}) {
  try {
    const payload = await response.json()
    return { ok: response.ok, status: response.status, payload }
  } catch {
    return { ok: response.ok, status: response.status, payload: fallback }
  }
}

/**
 * Normalize an event object so dashboard detail components never crash on
 * missing or partially loaded data.
 *
 * @param {object|null} event
 * @returns {object|null}
 */
export function normalizeEvent(event) {
  if (!event) return null
  return {
    ...event,
    id: event.id || '',
    name: event.name || '',
    slug: event.slug || '',
    billingTier: event.billingTier || null,
    originalDownloadUnlocked: !!event.originalDownloadUnlocked,
    coverUrl: event.coverUrl || null,
    photoCount: Number.isFinite(event.photoCount) ? event.photoCount : null,
    photos: Array.isArray(event.photos) ? event.photos : [],
    moments: Array.isArray(event.moments) ? event.moments : [],
    createdAt: event.createdAt || null,
    vaultExtendedUntil: event.vaultExtendedUntil || null,
    gracePeriodUntil: event.gracePeriodUntil || null,
    archiveLocked: event.archiveLocked === true,
  }
}
