import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'

export const DEFAULT_TTL_SECONDS = 3600
export const MIN_TTL_SECONDS = 60
export const MAX_TTL_SECONDS = 3600

/**
 * Blob pathname namespace for each upload kind.
 * Format: namespace/eventSlug/fileName
 */
const NAMESPACE_BY_KIND = {
  [BlobUploadKind.ROOM_PHOTO]: 'events',
  [BlobUploadKind.PRIVATE_DELIVERY]: 'private-delivery',
  [BlobUploadKind.PHOTOGRAPHER_UPLOAD]: 'private-delivery',
}

export class BlobUploadSessionInvariantError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BlobUploadSessionInvariantError'
  }
}

function assertDelegate(prisma) {
  if (
    !prisma ||
    typeof prisma.blobUploadSession !== 'object' ||
    prisma.blobUploadSession === null
  ) {
    throw new BlobUploadSessionInvariantError('prisma.blobUploadSession delegate is not available')
  }
}

/**
 * Validates a server-issued Vercel Blob pathname.
 *
 * expectedPathname is a logical blob pathname (namespace/eventSlug/fileName),
 * NOT a filesystem path. path.resolve() must NOT be used here.
 *
 * Valid examples:
 *   events/wedding-2026/uuid-photo.jpg
 *   private-delivery/wedding-2026/uuid-album.zip
 */
function validateExpectedPathname(expectedPathname, { uploadKind, eventSlug }) {
  if (typeof expectedPathname !== 'string' || expectedPathname.length === 0) {
    throw new BlobUploadSessionInvariantError('expectedPathname must be a non-empty string')
  }
  if (expectedPathname.length > 300) {
    throw new BlobUploadSessionInvariantError('expectedPathname exceeds 300 characters')
  }
  if (expectedPathname.startsWith('/')) {
    throw new BlobUploadSessionInvariantError('expectedPathname must not start with "/"')
  }
  if (expectedPathname.includes('\\')) {
    throw new BlobUploadSessionInvariantError('expectedPathname must not contain backslashes')
  }
  if (expectedPathname.includes('\0')) {
    throw new BlobUploadSessionInvariantError('expectedPathname must not contain NUL bytes')
  }
  if (expectedPathname.includes('%')) {
    throw new BlobUploadSessionInvariantError('expectedPathname must not contain percent-encoding')
  }
  if (expectedPathname.includes('//')) {
    throw new BlobUploadSessionInvariantError('expectedPathname must not contain "//"')
  }

  const segments = expectedPathname.split('/')
  if (segments.length !== 3) {
    throw new BlobUploadSessionInvariantError(
      'expectedPathname must have exactly three segments: namespace/eventSlug/fileName',
    )
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new BlobUploadSessionInvariantError('expectedPathname must not contain dot segments')
    }
  }

  const [namespace, slug, fileName] = segments

  if (fileName.length === 0) {
    throw new BlobUploadSessionInvariantError('expectedPathname fileName segment must not be empty')
  }

  const expectedNamespace = NAMESPACE_BY_KIND[uploadKind]
  if (!expectedNamespace) {
    throw new BlobUploadSessionInvariantError(`Unknown uploadKind: ${uploadKind}`)
  }
  if (namespace !== expectedNamespace) {
    throw new BlobUploadSessionInvariantError(
      `expectedPathname namespace "${namespace}" is incompatible with uploadKind "${uploadKind}" (expected "${expectedNamespace}")`,
    )
  }

  if (slug !== eventSlug) {
    throw new BlobUploadSessionInvariantError(
      'expectedPathname eventSlug segment does not match session eventSlug',
    )
  }
}

/**
 * Validates that blobUrl represents exactly the given expectedPathname.
 *
 * Enforces:
 *   - HTTPS protocol
 *   - hostname ends with .blob.vercel-storage.com
 *   - no username, password, port, or fragment
 *   - URL pathname === "/" + expectedPathname (exact, no percent-encoding variants)
 *
 * Throws BlobUploadSessionInvariantError for any violation (programmer error).
 * Error messages never include the full URL or any sensitive value.
 */
function validateBlobUrlForExpectedPathname(blobUrl, expectedPathname) {
  let parsed
  try {
    parsed = new URL(blobUrl)
  } catch {
    throw new BlobUploadSessionInvariantError('blobUrl is not a valid URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new BlobUploadSessionInvariantError('blobUrl must use HTTPS')
  }
  if (!parsed.hostname.endsWith('.blob.vercel-storage.com')) {
    throw new BlobUploadSessionInvariantError(
      'blobUrl hostname must end with .blob.vercel-storage.com',
    )
  }
  if (parsed.username !== '') {
    throw new BlobUploadSessionInvariantError('blobUrl must not contain credentials')
  }
  if (parsed.password !== '') {
    throw new BlobUploadSessionInvariantError('blobUrl must not contain credentials')
  }
  if (parsed.port !== '') {
    throw new BlobUploadSessionInvariantError('blobUrl must not specify a port')
  }
  if (parsed.hash !== '') {
    throw new BlobUploadSessionInvariantError('blobUrl must not contain a fragment')
  }
  if (parsed.search !== '') {
    throw new BlobUploadSessionInvariantError('blobUrl must not contain query parameters')
  }
  if (parsed.pathname !== '/' + expectedPathname) {
    throw new BlobUploadSessionInvariantError('blobUrl pathname does not match expectedPathname')
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Creates a new BlobUploadSession with status PENDING.
 *
 * The caller (server-side route handler) is responsible for generating
 * expectedPathname before calling this function. The foreign-key constraint
 * and the caller guarantee eventId validity — no separate existence query
 * is performed here.
 */
export async function createBlobUploadSession(
  prisma,
  {
    eventId,
    eventSlug,
    uploadKind,
    expectedPathname,
    originalName,
    mimeType,
    expectedSize,
    uploaderName,
    caption,
    momentId,
    contributorId,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    now,
  },
) {
  assertDelegate(prisma)

  if (!eventId) throw new BlobUploadSessionInvariantError('eventId is required')
  if (!eventSlug) throw new BlobUploadSessionInvariantError('eventSlug is required')

  if (!Object.values(BlobUploadKind).includes(uploadKind)) {
    throw new BlobUploadSessionInvariantError(`Invalid uploadKind: ${uploadKind}`)
  }
  if (!Number.isInteger(expectedSize) || expectedSize <= 0) {
    throw new BlobUploadSessionInvariantError('expectedSize must be a positive integer')
  }

  const clampedTtl = Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, ttlSeconds))
  if (clampedTtl !== ttlSeconds) {
    throw new BlobUploadSessionInvariantError(
      `ttlSeconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`,
    )
  }

  const normalizedMimeType = typeof mimeType === 'string' ? mimeType.toLowerCase() : mimeType

  validateExpectedPathname(expectedPathname, { uploadKind, eventSlug })

  const baseNow = now instanceof Date ? now : new Date()
  const expiresAt = new Date(baseNow.getTime() + clampedTtl * 1000)

  return prisma.blobUploadSession.create({
    data: {
      eventId,
      eventSlug,
      uploadKind,
      status: BlobUploadSessionStatus.PENDING,
      expectedPathname,
      originalName,
      mimeType: normalizedMimeType,
      expectedSize,
      uploaderName: uploaderName ?? null,
      caption: caption ?? null,
      momentId: momentId ?? null,
      contributorId: contributorId ?? null,
      expiresAt,
    },
  })
}

/**
 * Retrieves a BlobUploadSession by id.
 * Returns null (never throws) if the session does not exist.
 */
export async function getBlobUploadSession(prisma, sessionId) {
  assertDelegate(prisma)
  return prisma.blobUploadSession.findUnique({ where: { id: sessionId } })
}

/**
 * Atomically claims a PENDING session for blob token issuance.
 *
 * Idempotent: a concurrent or repeated call that finds the session already
 * in TOKEN_ISSUED with a matching pathname returns { ok: true, reissued: true }.
 *
 * Returns { ok: true, session, reissued } or { ok: false, reason }.
 * Reason values: not_found | expired | event_deleted | pathname_mismatch | invalid_status
 *
 * Does NOT throw for normal lifecycle failures.
 */
export async function claimBlobUploadSessionForToken(prisma, { sessionId, pathname, now }) {
  assertDelegate(prisma)

  const baseNow = now instanceof Date ? now : new Date()

  const updated = await prisma.blobUploadSession.updateMany({
    where: {
      id: sessionId,
      status: BlobUploadSessionStatus.PENDING,
      expectedPathname: pathname,
      expiresAt: { gt: baseNow },
      eventId: { not: null },
    },
    data: {
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      tokenIssuedAt: baseNow,
    },
  })

  if (updated.count === 1) {
    const session = await prisma.blobUploadSession.findUnique({ where: { id: sessionId } })
    return { ok: true, session, reissued: false }
  }

  const session = await prisma.blobUploadSession.findUnique({ where: { id: sessionId } })

  if (!session) return { ok: false, reason: 'not_found' }

  // Idempotent reissue for concurrent callers
  if (
    session.status === BlobUploadSessionStatus.TOKEN_ISSUED &&
    session.expectedPathname === pathname &&
    session.expiresAt > baseNow
  ) {
    return { ok: true, session, reissued: true }
  }

  if (session.expectedPathname !== pathname) return { ok: false, reason: 'pathname_mismatch' }
  if (session.expiresAt <= baseNow) return { ok: false, reason: 'expired' }
  if (session.eventId === null) return { ok: false, reason: 'event_deleted' }

  return { ok: false, reason: 'invalid_status' }
}

/**
 * Records that a blob has been successfully uploaded (onUploadCompleted callback).
 *
 * Validates that blobUrl exactly represents the session's expectedPathname.
 * Idempotent for duplicate callbacks with the same blobUrl.
 * Does not require expiresAt > now: a callback arriving after expiry must still
 * register the blob so that the cleanup job can delete it.
 *
 * Returns { ok: true, session, idempotent } or { ok: false, reason }.
 * Reason values: not_found | pathname_mismatch | blob_url_conflict | invalid_status
 *
 * Throws BlobUploadSessionInvariantError for invalid blobUrl (programmer error).
 */
export async function markBlobUploadSessionUploaded(
  prisma,
  { sessionId, pathname, blobUrl, uploadedAt },
) {
  assertDelegate(prisma)

  validateBlobUrlForExpectedPathname(blobUrl, pathname)

  const baseUploadedAt = uploadedAt instanceof Date ? uploadedAt : new Date()

  const updated = await prisma.blobUploadSession.updateMany({
    where: {
      id: sessionId,
      status: BlobUploadSessionStatus.TOKEN_ISSUED,
      expectedPathname: pathname,
    },
    data: {
      status: BlobUploadSessionStatus.UPLOADED,
      blobUrl,
      uploadedAt: baseUploadedAt,
    },
  })

  if (updated.count === 1) {
    const session = await prisma.blobUploadSession.findUnique({ where: { id: sessionId } })
    return { ok: true, session, idempotent: false }
  }

  const session = await prisma.blobUploadSession.findUnique({ where: { id: sessionId } })

  if (!session) return { ok: false, reason: 'not_found' }
  if (session.expectedPathname !== pathname) return { ok: false, reason: 'pathname_mismatch' }

  if (
    session.status === BlobUploadSessionStatus.UPLOADED ||
    session.status === BlobUploadSessionStatus.COMPLETED
  ) {
    if (session.blobUrl === blobUrl) return { ok: true, session, idempotent: true }
    return { ok: false, reason: 'blob_url_conflict' }
  }

  return { ok: false, reason: 'invalid_status' }
}

/**
 * Atomically claims a session for completion inside a Prisma transaction.
 *
 * MUST be called inside the same Prisma transaction that creates the
 * Photo or PrivateAsset and calls finalizeBlobUploadSession().
 *
 * Prefetches the session to validate that blobUrl exactly represents this
 * session's expectedPathname. The updateMany WHERE additionally guards that
 * the stored blobUrl is either null or equal to the incoming blobUrl,
 * preventing any overwrite of a conflicting stored URL.
 *
 * Sets consumedAt to prevent concurrent completions. Does NOT yet set
 * status to COMPLETED — that is done by finalizeBlobUploadSession().
 *
 * Returns { ok: true, session, idempotent } or { ok: false, reason }.
 * Reason values: not_found | expired | event_deleted | token_not_issued |
 *                in_progress | blob_url_conflict | invalid_status
 *
 * Throws BlobUploadSessionInvariantError for invalid blobUrl (programmer error).
 */
export async function claimBlobUploadSessionForCompletion(
  transactionClient,
  { sessionId, blobUrl, now },
) {
  assertDelegate(transactionClient)

  const baseNow = now instanceof Date ? now : new Date()

  // Prefetch to obtain expectedPathname for blobUrl validation.
  // Within a transaction this read is MVCC-consistent with the subsequent updateMany.
  const existing = await transactionClient.blobUploadSession.findUnique({
    where: { id: sessionId },
  })
  if (!existing) return { ok: false, reason: 'not_found' }

  validateBlobUrlForExpectedPathname(blobUrl, existing.expectedPathname) // throws on programmer error

  // Early idempotency check for already-finalized sessions
  if (existing.status === BlobUploadSessionStatus.COMPLETED && existing.resultId !== null) {
    if (existing.blobUrl === blobUrl) return { ok: true, session: existing, idempotent: true }
    return { ok: false, reason: 'blob_url_conflict' }
  }

  // OR condition ensures we never overwrite a stored blobUrl with a different value
  const updated = await transactionClient.blobUploadSession.updateMany({
    where: {
      id: sessionId,
      status: { in: [BlobUploadSessionStatus.TOKEN_ISSUED, BlobUploadSessionStatus.UPLOADED] },
      consumedAt: null,
      expiresAt: { gt: baseNow },
      eventId: { not: null },
      OR: [{ blobUrl: null }, { blobUrl }],
    },
    data: {
      consumedAt: baseNow,
      blobUrl,
    },
  })

  if (updated.count === 1) {
    const session = await transactionClient.blobUploadSession.findUnique({
      where: { id: sessionId },
    })
    return { ok: true, session, idempotent: false }
  }

  // Classify failure — refetch for latest state after concurrent write
  const session = await transactionClient.blobUploadSession.findUnique({
    where: { id: sessionId },
  })
  if (!session) return { ok: false, reason: 'not_found' }

  // Check COMPLETED first: another transaction may have finalized the session
  // between our prefetch and this refetch. Without this check, a COMPLETED
  // session with consumedAt set would fall through to 'in_progress' incorrectly.
  if (session.status === BlobUploadSessionStatus.COMPLETED && session.resultId !== null) {
    if (session.blobUrl === blobUrl) return { ok: true, session, idempotent: true }
    return { ok: false, reason: 'blob_url_conflict' }
  }

  if (session.expiresAt <= baseNow) return { ok: false, reason: 'expired' }
  if (session.eventId === null) return { ok: false, reason: 'event_deleted' }
  if (session.consumedAt !== null) return { ok: false, reason: 'in_progress' }
  if (session.blobUrl !== null && session.blobUrl !== blobUrl) {
    return { ok: false, reason: 'blob_url_conflict' }
  }
  if (session.status === BlobUploadSessionStatus.PENDING) {
    return { ok: false, reason: 'token_not_issued' }
  }

  return { ok: false, reason: 'invalid_status' }
}

/**
 * Transitions a claimed session to COMPLETED and records the created record id.
 *
 * MUST be called inside the same Prisma transaction as
 * claimBlobUploadSessionForCompletion() and the Photo/PrivateAsset creation.
 *
 * Throws BlobUploadSessionInvariantError for impossible states (programmer error).
 */
export async function finalizeBlobUploadSession(transactionClient, { sessionId, resultId }) {
  assertDelegate(transactionClient)

  if (!resultId) {
    throw new BlobUploadSessionInvariantError('resultId is required for finalization')
  }

  const updated = await transactionClient.blobUploadSession.updateMany({
    where: {
      id: sessionId,
      consumedAt: { not: null },
      resultId: null,
      status: { in: [BlobUploadSessionStatus.TOKEN_ISSUED, BlobUploadSessionStatus.UPLOADED] },
    },
    data: {
      status: BlobUploadSessionStatus.COMPLETED,
      resultId,
    },
  })

  if (updated.count === 1) {
    return transactionClient.blobUploadSession.findUnique({ where: { id: sessionId } })
  }

  const session = await transactionClient.blobUploadSession.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    throw new BlobUploadSessionInvariantError('finalizeBlobUploadSession: session not found')
  }

  if (session.status === BlobUploadSessionStatus.COMPLETED) {
    if (session.resultId === resultId) return session
    throw new BlobUploadSessionInvariantError(
      'finalizeBlobUploadSession: session already COMPLETED with a different resultId',
    )
  }

  throw new BlobUploadSessionInvariantError(
    `finalizeBlobUploadSession: unexpected state "${session.status}" — consumedAt set: ${session.consumedAt !== null}, resultId set: ${session.resultId !== null}`,
  )
}
