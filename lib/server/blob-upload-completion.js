import { BlobUploadKind, BlobUploadSessionStatus } from '@prisma/client'
import { BlobNotFoundError } from '@vercel/blob'
import {
  BlobUploadSessionInvariantError,
  claimBlobUploadSessionForCompletion,
  finalizeBlobUploadSession,
  getBlobUploadSession,
} from './blob-upload-session.js'
import { getStoredNameFromBlobPathname } from './storage/index.js'
import { normalizePhotoRecord } from './repository-mappers.js'

/**
 * Constraints:
 * - Does not import getPrismaClient().
 * - Does not create PrismaClient.
 * - Does not import route.js or client components.
 * - Does not make direct network calls (headBlob/deleteBlob are injected).
 * - Does not read environment variables.
 * - Does not log URLs, sessionIds, payloads, or full tokens.
 */

// ─── Error class ──────────────────────────────────────────────────────────────

export class BlobUploadCompletionError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} publicMessage
   * @param {{ details?: object, cleanupRequired?: boolean }} [options]
   */
  constructor(code, status, publicMessage, { details, cleanupRequired = false } = {}) {
    super(`BlobUploadCompletionError: ${code}`)
    this.name = 'BlobUploadCompletionError'
    this.code = code
    this.status = status
    this.publicMessage = publicMessage
    this.details = details
    this.cleanupRequired = cleanupRequired
  }
}

// ─── Error map ────────────────────────────────────────────────────────────────

const COMPLETION_ERRORS = {
  session_not_found:     [404, 'Upload session not found.'],
  session_expired:       [410, 'Upload session has expired.'],
  event_deleted:         [410, 'Associated event no longer exists.'],
  token_not_issued:      [409, 'Upload token has not been issued for this session.'],
  invalid_upload_kind:   [409, 'Upload session is not a room photo session.'],
  invalid_status:        [409, 'Upload session is not in the expected state.'],
  completion_in_progress:[409, 'Upload is already being processed.'],
  blob_not_found:        [409, 'Upload file not found in storage.'],
  blob_metadata_invalid: [502, 'Upload file metadata is invalid.'],
  blob_too_large:        [413, 'Upload file exceeds the allowed size.'],
  blob_mime_mismatch:    [415, 'Upload file type does not match the expected type.'],
  blob_url_conflict:     [409, 'A different upload has already been recorded for this session.'],
  invalid_moment:        [409, 'Upload moment is invalid.'],
  photo_limit:           [403, 'This room has reached its photo limit.'],
  result_missing:        [500, 'Upload result is unavailable.'],
  database_unavailable:  [503, 'Upload service is temporarily unavailable.'],
}

function makeCompletionError(code, options) {
  const [status, publicMessage] = COMPLETION_ERRORS[code] ?? [400, 'Upload failed.']
  return new BlobUploadCompletionError(code, status, publicMessage, options)
}

// ─── Claim → completion error mapping ────────────────────────────────────────

const CLAIM_ERROR_TO_COMPLETION_CODE = {
  not_found:        'session_not_found',
  expired:          'session_expired',
  event_deleted:    'event_deleted',
  token_not_issued: 'token_not_issued',
  in_progress:      'completion_in_progress',
  blob_url_conflict:'blob_url_conflict',
  invalid_status:   'invalid_status',
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_PREFLIGHT_STATUSES = new Set([
  BlobUploadSessionStatus.TOKEN_ISSUED,
  BlobUploadSessionStatus.UPLOADED,
])

const CLEANUP_ELIGIBLE_STATUSES = [
  BlobUploadSessionStatus.TOKEN_ISSUED,
  BlobUploadSessionStatus.UPLOADED,
  BlobUploadSessionStatus.REJECTED,
  BlobUploadSessionStatus.CLEANUP_FAILED,
]

// ─── Safe cleanup ─────────────────────────────────────────────────────────────

async function safeCleanup({ prisma, sessionId, headResult, deleteBlob, error, logWarn }) {
  // 1. Atomically transition to CLEANUP_PENDING (only when resultId IS NULL and
  //    status is in the eligible set — prevents touching a completed session).
  let marked
  try {
    marked = await prisma.blobUploadSession.updateMany({
      where: {
        id: sessionId,
        resultId: null,
        status: { in: CLEANUP_ELIGIBLE_STATUSES },
      },
      data: {
        status: BlobUploadSessionStatus.CLEANUP_PENDING,
        lastError: error.code,
      },
    })
  } catch {
    // Cannot mark — abort cleanup safely
    return
  }

  // 2. count = 0 → session moved out of eligible states concurrently; verify COMPLETED
  if (marked.count === 0) {
    try {
      const session = await prisma.blobUploadSession.findUnique({ where: { id: sessionId } })
      if (session?.status === BlobUploadSessionStatus.COMPLETED) {
        // Another request completed the session — do NOT delete
        return
      }
    } catch {
      // Cannot determine state — do not delete
    }
    return
  }

  // 3. Attempt to delete the orphaned blob
  try {
    await deleteBlob(headResult.url)

    // 4. Delete succeeded → REJECTED
    await prisma.blobUploadSession.updateMany({
      where: {
        id: sessionId,
        status: BlobUploadSessionStatus.CLEANUP_PENDING,
      },
      data: {
        status: BlobUploadSessionStatus.REJECTED,
        lastError: error.code,
      },
    })
  } catch {
    // 5. Delete failed → CLEANUP_FAILED; log static code only
    logWarn('[blob-upload-completion] cleanup failed')
    try {
      await prisma.blobUploadSession.updateMany({
        where: {
          id: sessionId,
          status: BlobUploadSessionStatus.CLEANUP_PENDING,
        },
        data: {
          status: BlobUploadSessionStatus.CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: error.code,
        },
      })
    } catch {
      // Best-effort — ignore secondary failure
    }
  }
}

// ─── completeRoomPhotoBlobUpload ──────────────────────────────────────────────

/**
 * Completes a ROOM_PHOTO Blob upload from server-side metadata only.
 *
 * Workflow:
 *   1. Preflight — classify the session without calling headBlob.
 *   2. Server-side verification — call headBlob(expectedPathname).
 *   3. Atomic transaction — lock Event, claim session, check entitlement,
 *      create Photo, update cover, finalize session.
 *   4. Safe cleanup — delete orphaned blob on permanent errors.
 *
 * Returns { photo, eventSlug, idempotent }.
 *
 * @param {{
 *   prisma: object,
 *   sessionId: string,
 *   headBlob: (pathname: string) => Promise<object>,
 *   deleteBlob: (url: string) => Promise<void>,
 *   checkEntitlement: (tx: object, event: object) => Promise<object>,
 *   now?: () => Date,
 *   logger?: { warn?: Function, error?: Function },
 * }} options
 */
export async function completeRoomPhotoBlobUpload({
  prisma,
  sessionId,
  headBlob,
  deleteBlob,
  checkEntitlement,
  now = () => new Date(),
  logger,
}) {
  // ── Validate arguments ────────────────────────────────────────────────────

  if (
    !prisma ||
    typeof prisma.blobUploadSession !== 'object' ||
    prisma.blobUploadSession === null ||
    typeof prisma.photo !== 'object' ||
    prisma.photo === null ||
    typeof prisma.event !== 'object' ||
    prisma.event === null ||
    typeof prisma.$transaction !== 'function'
  ) {
    throw makeCompletionError('database_unavailable')
  }
  if (typeof headBlob !== 'function') {
    throw new Error('completeRoomPhotoBlobUpload: headBlob must be a function')
  }
  if (typeof deleteBlob !== 'function') {
    throw new Error('completeRoomPhotoBlobUpload: deleteBlob must be a function')
  }
  if (typeof checkEntitlement !== 'function') {
    throw new Error('completeRoomPhotoBlobUpload: checkEntitlement must be a function')
  }

  const logWarn = (msg) => {
    if (typeof logger?.warn === 'function') logger.warn(msg)
  }

  // ── Preflight ─────────────────────────────────────────────────────────────

  const preflightSession = await getBlobUploadSession(prisma, sessionId)

  if (!preflightSession) {
    throw makeCompletionError('session_not_found')
  }

  if (preflightSession.uploadKind !== BlobUploadKind.ROOM_PHOTO) {
    throw makeCompletionError('invalid_upload_kind')
  }

  // Idempotent COMPLETED path — return existing Photo without calling headBlob
  if (preflightSession.status === BlobUploadSessionStatus.COMPLETED) {
    if (!preflightSession.resultId) {
      throw makeCompletionError('result_missing')
    }
    const photo = await prisma.photo.findUnique({ where: { id: preflightSession.resultId } })
    if (!photo || photo.eventId !== preflightSession.eventId) {
      throw makeCompletionError('result_missing')
    }
    return {
      photo: normalizePhotoRecord(photo),
      eventSlug: preflightSession.eventSlug,
      idempotent: true,
    }
  }

  if (preflightSession.eventId === null) {
    throw makeCompletionError('event_deleted')
  }

  const nowDate = now()
  if (preflightSession.expiresAt <= nowDate) {
    throw makeCompletionError('session_expired')
  }

  if (preflightSession.status === BlobUploadSessionStatus.PENDING) {
    throw makeCompletionError('token_not_issued')
  }

  if (!ALLOWED_PREFLIGHT_STATUSES.has(preflightSession.status)) {
    throw makeCompletionError('invalid_status')
  }

  // ── Server-side blob verification ─────────────────────────────────────────

  let headResult
  try {
    headResult = await headBlob(preflightSession.expectedPathname)
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      throw makeCompletionError('blob_not_found')
    }
    throw error
  }

  if (
    headResult === null ||
    typeof headResult !== 'object' ||
    Array.isArray(headResult) ||
    typeof headResult.url !== 'string' ||
    headResult.url.trim() === '' ||
    typeof headResult.pathname !== 'string' ||
    headResult.pathname.trim() === '' ||
    typeof headResult.size !== 'number' ||
    !Number.isInteger(headResult.size) ||
    headResult.size <= 0 ||
    typeof headResult.contentType !== 'string' ||
    headResult.contentType.trim() === ''
  ) {
    throw makeCompletionError('blob_metadata_invalid')
  }

  if (headResult.pathname !== preflightSession.expectedPathname) {
    // Do NOT attempt to delete — unsafe to act on an unknown object
    throw makeCompletionError('blob_metadata_invalid')
  }

  // Normalize MIME before the cleanup-eligible checks (also needed inside transaction)
  const actualMime = headResult.contentType.split(';')[0].trim().toLowerCase()

  // ── Atomic transaction + cleanup wrapper ─────────────────────────────────
  //
  // blob_too_large and blob_mime_mismatch both have cleanupRequired=true, so
  // they must be inside this try-catch so safeCleanup is invoked on throw.

  let txResult
  try {
    if (headResult.size > preflightSession.expectedSize) {
      throw makeCompletionError('blob_too_large', { cleanupRequired: true })
    }
    if (actualMime !== preflightSession.mimeType.trim().toLowerCase()) {
      throw makeCompletionError('blob_mime_mismatch', { cleanupRequired: true })
    }

    txResult = await prisma.$transaction(async (tx) => {
      // 1. Lock Event row before photo count to prevent races to the limit
      let event
      try {
        event = await tx.event.update({
          where: { id: preflightSession.eventId },
          data: { updatedAt: nowDate },
        })
      } catch (error) {
        if (error?.code === 'P2025') {
          throw makeCompletionError('event_deleted')
        }
        throw error
      }

      // 2. Invariant: slug must not have changed under this eventId
      if (event.slug !== preflightSession.eventSlug) {
        throw new BlobUploadSessionInvariantError(
          'completeRoomPhotoBlobUpload: event slug mismatch inside transaction',
        )
      }

      // 3. Atomic claim (sets consumedAt and blobUrl; does not change status)
      const claim = await claimBlobUploadSessionForCompletion(tx, {
        sessionId,
        blobUrl: headResult.url,
        now: nowDate,
      })

      if (!claim.ok) {
        const completionCode =
          CLAIM_ERROR_TO_COMPLETION_CODE[claim.reason] ?? 'invalid_status'
        throw makeCompletionError(completionCode)
      }

      // 4. Idempotent claim path (concurrent completion finalized between preflight and here)
      if (claim.idempotent) {
        const photo = await tx.photo.findUnique({ where: { id: claim.session.resultId } })
        if (!photo || photo.eventId !== event.id) {
          throw makeCompletionError('result_missing')
        }
        return { photo, eventSlug: event.slug, idempotent: true }
      }

      // 5. Defense-in-depth invariant checks on the claimed session
      if (claim.session.uploadKind !== BlobUploadKind.ROOM_PHOTO) {
        throw new BlobUploadSessionInvariantError(
          'completeRoomPhotoBlobUpload: uploadKind mismatch after claim',
        )
      }
      if (claim.session.eventId !== event.id) {
        throw new BlobUploadSessionInvariantError(
          'completeRoomPhotoBlobUpload: eventId mismatch after claim',
        )
      }
      if (claim.session.expectedPathname !== headResult.pathname) {
        throw new BlobUploadSessionInvariantError(
          'completeRoomPhotoBlobUpload: expectedPathname mismatch after claim',
        )
      }

      // 6. Validate momentId belongs to this event
      if (claim.session.momentId) {
        const moment = await tx.eventMoment.findFirst({
          where: { id: claim.session.momentId, eventId: event.id },
          select: { id: true },
        })
        if (!moment) {
          throw makeCompletionError('invalid_moment', { cleanupRequired: true })
        }
      }

      // 7. Final entitlement check — after row lock so two requests cannot both
      //    read the same photo count and both pass the limit simultaneously
      const entitlement = await checkEntitlement(tx, event)
      if (entitlement.error) {
        throw makeCompletionError('database_unavailable')
      }
      if (!entitlement.allowed) {
        throw makeCompletionError('photo_limit', {
          cleanupRequired: true,
          details: {
            limit: 'photo_count',
            current: entitlement.current,
            max: entitlement.max,
            upgradePath: entitlement.upgradePath,
            eventId: event.id,
            eventSlug: event.slug,
          },
        })
      }

      // 8. Create Photo directly in the transaction (not via repository to stay
      //    within the same transaction as claim and finalize)
      const photo = await tx.photo.create({
        data: {
          eventId: event.id,
          originalName: claim.session.originalName,
          storedName: getStoredNameFromBlobPathname(claim.session.expectedPathname),
          mimeType: actualMime,
          size: headResult.size,
          url: headResult.url,
          uploaderName: claim.session.uploaderName || null,
          caption: claim.session.caption || null,
          status: 'VISIBLE',
          momentId: claim.session.momentId || null,
        },
      })

      // 9. Update event cover photo to the newest visible photo
      await tx.event.update({
        where: { id: event.id },
        data: { coverPhotoId: photo.id, updatedAt: nowDate },
      })

      // 10. Finalize session (COMPLETED + resultId)
      await finalizeBlobUploadSession(tx, { sessionId, resultId: photo.id })

      // 11. Return result
      return { photo, eventSlug: event.slug, idempotent: false }
    })
  } catch (error) {
    // Safe cleanup for permanent errors that leave an orphaned blob in storage
    if (error instanceof BlobUploadCompletionError && error.cleanupRequired) {
      await safeCleanup({ prisma, sessionId, headResult, deleteBlob, error, logWarn })
    }
    throw error
  }

  return {
    photo: normalizePhotoRecord(txResult.photo),
    eventSlug: txResult.eventSlug,
    idempotent: txResult.idempotent,
  }
}
