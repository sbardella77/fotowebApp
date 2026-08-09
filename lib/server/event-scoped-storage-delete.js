/**
 * Event-scoped storage deletion guard.
 *
 * Photo and PrivateAsset records created before the BlobUploadSession protocol
 * may contain a `url` field whose value was supplied by an untrusted browser.
 * A malicious record could embed the URL of a Blob belonging to a different
 * event, turning the server into a confused deputy that deletes an unrelated
 * Blob when the owning event/record is legitimately deleted.
 *
 * This module validates that a stored file URL/path is coherent with the
 * owning event and record type BEFORE calling the underlying delete primitive.
 * Mismatched references are silently skipped; the DB record can still be
 * removed by the caller without storage side-effects.
 *
 * Constraints:
 * - Does not import getPrismaClient().
 * - Does not make network calls.
 * - Does not log URLs, paths, or eventSlugs.
 * - eventSlug MUST come from the DB event record, never from client input.
 */

/** Blob storage namespace for each kind. */
const NAMESPACE_BY_KIND = {
  'room-photo': 'events',
  'private-asset': 'private-delivery',
}

/**
 * Validates a Vercel Blob HTTPS URL for the given namespace + eventSlug.
 *
 * Requires:
 *   - https: protocol
 *   - hostname ends with .blob.vercel-storage.com
 *   - no username / password / port
 *   - no query string or fragment
 *   - no % / backslash / NUL in pathname
 *   - exactly 3 non-empty pathname segments with no dot segments
 *   - segment[0] === namespace
 *   - segment[1] === eventSlug (exact, no prefix-collision)
 *   - segment[2].length > 0 (non-empty filename)
 *
 * @param {string} url
 * @param {string} namespace  e.g. "events" or "private-delivery"
 * @param {string} eventSlug
 * @returns {boolean}
 */
function isValidVercelBlobUrl(url, namespace, eventSlug) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (!parsed.hostname.endsWith('.blob.vercel-storage.com')) return false
  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '') return false
  if (parsed.search !== '' || parsed.hash !== '') return false

  const p = parsed.pathname
  if (p.includes('%') || p.includes('\\') || p.includes('\0')) return false

  const segs = p.split('/').filter(Boolean)
  if (segs.length !== 3) return false
  for (const s of segs) {
    if (s === '.' || s === '..') return false
    if (s.length === 0) return false
  }

  return segs[0] === namespace && segs[1] === eventSlug && segs[2].length > 0
}

/**
 * Validates a local /uploads/... path for the given namespace + eventSlug.
 *
 * Requires:
 *   - no % / backslash / NUL
 *   - exactly 4 non-empty path segments when split on /
 *   - no dot segments
 *   - segment[0] === "uploads"
 *   - segment[1] === namespace
 *   - segment[2] === eventSlug (exact)
 *   - segment[3].length > 0 (non-empty filename)
 *
 * @param {string} url
 * @param {string} namespace
 * @param {string} eventSlug
 * @returns {boolean}
 */
function isValidLocalPath(url, namespace, eventSlug) {
  if (url.includes('%') || url.includes('\\') || url.includes('\0')) return false

  const segs = url.split('/').filter(Boolean)
  if (segs.length !== 4) return false
  for (const s of segs) {
    if (s === '.' || s === '..') return false
    if (s.length === 0) return false
  }

  return (
    segs[0] === 'uploads' &&
    segs[1] === namespace &&
    segs[2] === eventSlug &&
    segs[3].length > 0
  )
}

/**
 * Deletes a stored file only when the URL/path is coherent with the owning
 * event and record type.
 *
 * If the reference is unsafe or mismatched:
 *   - deleteFile is NOT called
 *   - a static warning is logged (no URL/path/eventSlug emitted)
 *   - returns { deleted: false, skipped: true }
 *
 * If the reference is valid:
 *   - deleteFile(url) is awaited
 *   - returns { deleted: true, skipped: false }
 *
 * Propagates exceptions thrown by deleteFile unchanged — the caller's
 * try/catch should handle storage errors as before.
 *
 * @param {object} options
 * @param {string} options.url        - photo.url or asset.url from the DB record
 * @param {string} options.eventSlug  - event.slug from the DB event record (server-authoritative)
 * @param {'room-photo'|'private-asset'} options.kind
 * @param {(url: string) => Promise<void>} options.deleteFile
 * @param {{ warn?: Function } | null} [options.logger]
 * @returns {Promise<{ deleted: boolean, skipped: boolean }>}
 */
export async function deleteEventScopedStoredFile({
  url,
  eventSlug,
  kind,
  deleteFile,
  logger,
}) {
  const namespace = NAMESPACE_BY_KIND[kind]
  if (!namespace) {
    throw new Error(`deleteEventScopedStoredFile: unknown kind "${kind}"`)
  }

  // Guard empty/invalid inputs — both url and eventSlug must be non-empty strings.
  if (
    !url ||
    typeof url !== 'string' ||
    url.length === 0 ||
    !eventSlug ||
    typeof eventSlug !== 'string' ||
    eventSlug.length === 0
  ) {
    logger?.warn?.('[event-scoped-delete] skipped unsafe legacy storage reference')
    return { deleted: false, skipped: true }
  }

  // Guard malformed eventSlug — should never occur for slugs from the DB,
  // but prevents separator-injection from bypassing the segment checks below.
  if (
    eventSlug.includes('/') ||
    eventSlug.includes('\\') ||
    eventSlug.includes('\0') ||
    eventSlug.includes('%')
  ) {
    logger?.warn?.('[event-scoped-delete] skipped unsafe legacy storage reference')
    return { deleted: false, skipped: true }
  }

  const isVercel = url.startsWith('https://') || url.startsWith('http://')
  const valid = isVercel
    ? isValidVercelBlobUrl(url, namespace, eventSlug)
    : isValidLocalPath(url, namespace, eventSlug)

  if (!valid) {
    logger?.warn?.('[event-scoped-delete] skipped unsafe legacy storage reference')
    return { deleted: false, skipped: true }
  }

  await deleteFile(url)
  return { deleted: true, skipped: false }
}
