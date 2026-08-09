import { BlobUploadSessionStatus } from '@prisma/client'
import { BlobNotFoundError } from '@vercel/blob'

export const DEFAULT_BLOB_CLEANUP_BATCH_SIZE = 100
export const STALE_CLEANUP_PENDING_MS = 15 * 60 * 1000

const {
  PENDING,
  TOKEN_ISSUED,
  UPLOADED,
  CLEANUP_PENDING,
  CLEANUP_FAILED,
  EXPIRED_CLEANED,
  REJECTED,
} = BlobUploadSessionStatus

/**
 * Cleans up expired and orphaned BlobUploadSession records.
 *
 * Candidates selected in a single findMany:
 *   A) status IN [PENDING, TOKEN_ISSUED, UPLOADED] AND expiresAt <= now AND resultId = null
 *   B) status = CLEANUP_FAILED AND resultId = null
 *   C) status = CLEANUP_PENDING AND updatedAt <= now - STALE_CLEANUP_PENDING_MS AND resultId = null
 *
 * COMPLETED, REJECTED, EXPIRED_CLEANED, and sessions with resultId != null are never selected.
 *
 * Each candidate is claimed atomically with updateMany before any storage operation.
 *
 * Returns stats object with integer counts only — never exposes IDs, URLs, or pathnames.
 */
export async function cleanupBlobUploadSessions({
  prisma,
  headBlob,
  deleteBlob,
  now = () => new Date(),
  batchSize = DEFAULT_BLOB_CLEANUP_BATCH_SIZE,
  logger = console,
}) {
  if (!prisma || typeof prisma.blobUploadSession !== 'object' || prisma.blobUploadSession === null) {
    throw new Error('cleanupBlobUploadSessions: prisma.blobUploadSession delegate is required')
  }
  if (typeof headBlob !== 'function') {
    throw new Error('cleanupBlobUploadSessions: headBlob must be a function')
  }
  if (typeof deleteBlob !== 'function') {
    throw new Error('cleanupBlobUploadSessions: deleteBlob must be a function')
  }

  const resolvedBatchSize = batchSize !== undefined ? batchSize : DEFAULT_BLOB_CLEANUP_BATCH_SIZE
  if (!Number.isInteger(resolvedBatchSize) || resolvedBatchSize < 1 || resolvedBatchSize > 500) {
    throw new Error('cleanupBlobUploadSessions: batchSize must be an integer between 1 and 500')
  }

  const nowDate = typeof now === 'function' ? now() : new Date()
  const staleCutoff = new Date(nowDate.getTime() - STALE_CLEANUP_PENDING_MS)

  // ─── Candidate selection ────────────────────────────────────────────────────

  const candidates = await prisma.blobUploadSession.findMany({
    where: {
      resultId: null,
      OR: [
        // A: expired active sessions
        {
          status: { in: [PENDING, TOKEN_ISSUED, UPLOADED] },
          expiresAt: { lte: nowDate },
        },
        // B: CLEANUP_FAILED — retry regardless of expiry
        {
          status: CLEANUP_FAILED,
        },
        // C: stale CLEANUP_PENDING — recovery after crash
        {
          status: CLEANUP_PENDING,
          updatedAt: { lte: staleCutoff },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      expectedPathname: true,
      blobUrl: true,
      resultId: true,
      expiresAt: true,
      updatedAt: true,
      cleanupAttempts: true,
    },
    orderBy: { updatedAt: 'asc' },
    take: resolvedBatchSize,
  })

  const stats = {
    candidates: candidates.length,
    claimed: 0,
    skipped: 0,
    noBlob: 0,
    blobsDeleted: 0,
    expiredCleaned: 0,
    rejected: 0,
    cleanupFailed: 0,
    headErrors: 0,
    deleteErrors: 0,
    metadataConflicts: 0,
  }

  // ─── Process each candidate ─────────────────────────────────────────────────

  for (const candidate of candidates) {
    // Build claim WHERE — optimistic lock on updatedAt prevents double-processing
    const claimWhere = {
      id: candidate.id,
      status: candidate.status,
      resultId: null,
      updatedAt: candidate.updatedAt,
    }

    // Expired active sessions require expiresAt guard in WHERE for safety
    if (
      candidate.status === PENDING ||
      candidate.status === TOKEN_ISSUED ||
      candidate.status === UPLOADED
    ) {
      claimWhere.expiresAt = { lte: nowDate }
    }

    // Atomically claim → CLEANUP_PENDING
    const claimed = await prisma.blobUploadSession.updateMany({
      where: claimWhere,
      data: {
        status: CLEANUP_PENDING,
        updatedAt: nowDate,
      },
    })

    if (claimed.count !== 1) {
      stats.skipped++
      continue
    }

    stats.claimed++

    // Verify post-claim state — another concurrent transaction may have intervened
    const session = await prisma.blobUploadSession.findUnique({
      where: { id: candidate.id },
    })

    if (!session || session.resultId !== null || session.status !== CLEANUP_PENDING) {
      // Session moved to COMPLETED or acquired a resultId concurrently — skip
      stats.skipped++
      continue
    }

    // ── PENDING expired: no Blob was ever issued ─────────────────────────────

    if (candidate.status === PENDING) {
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: { status: EXPIRED_CLEANED, lastError: null },
      })
      stats.expiredCleaned++
      continue
    }

    // ── TOKEN_ISSUED / UPLOADED / CLEANUP_FAILED / stale CLEANUP_PENDING ─────
    // Verify storage server-side using server-issued pathname (never client input)

    let headResult
    try {
      headResult = await headBlob(session.expectedPathname)
    } catch (err) {
      if (err instanceof BlobNotFoundError) {
        // Blob was never uploaded or already deleted — treat as clean
        const finalStatus = candidate.expiresAt <= nowDate ? EXPIRED_CLEANED : REJECTED
        await prisma.blobUploadSession.updateMany({
          where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
          data: { status: finalStatus },
        })
        stats.noBlob++
        if (finalStatus === EXPIRED_CLEANED) {
          stats.expiredCleaned++
        } else {
          stats.rejected++
        }
        continue
      }

      // Unknown head error — mark for retry
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: {
          status: CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: 'blob_head_failed',
        },
      })
      logger.warn('[blob-upload-cleanup] blob head failed')
      stats.headErrors++
      stats.cleanupFailed++
      continue
    }

    // ── Validate head result ─────────────────────────────────────────────────

    if (
      typeof headResult !== 'object' ||
      headResult === null ||
      typeof headResult.url !== 'string' ||
      headResult.url.length === 0 ||
      typeof headResult.pathname !== 'string' ||
      headResult.pathname.length === 0
    ) {
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: {
          status: CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: 'blob_metadata_invalid',
        },
      })
      stats.metadataConflicts++
      stats.cleanupFailed++
      continue
    }

    // Pathname must match exactly — never delete a blob at an unexpected path
    if (headResult.pathname !== session.expectedPathname) {
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: {
          status: CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: 'blob_metadata_invalid',
        },
      })
      stats.metadataConflicts++
      stats.cleanupFailed++
      continue
    }

    // If a blobUrl was recorded at upload time, it must match the head URL
    if (session.blobUrl !== null && session.blobUrl !== headResult.url) {
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: {
          status: CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: 'blob_url_conflict',
        },
      })
      stats.metadataConflicts++
      stats.cleanupFailed++
      continue
    }

    // ── Delete blob ──────────────────────────────────────────────────────────
    // Always use headResult.url — never session.blobUrl, expectedPathname, or client input

    try {
      await deleteBlob(headResult.url)
      stats.blobsDeleted++
    } catch {
      await prisma.blobUploadSession.updateMany({
        where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
        data: {
          status: CLEANUP_FAILED,
          cleanupAttempts: { increment: 1 },
          lastError: 'blob_delete_failed',
        },
      })
      logger.warn('[blob-upload-cleanup] blob delete failed')
      stats.deleteErrors++
      stats.cleanupFailed++
      continue
    }

    // ── Finalize ─────────────────────────────────────────────────────────────

    const finalStatus = candidate.expiresAt <= nowDate ? EXPIRED_CLEANED : REJECTED
    const finalUpdate = await prisma.blobUploadSession.updateMany({
      where: { id: candidate.id, status: CLEANUP_PENDING, resultId: null },
      data: {
        status: finalStatus,
        lastError: finalStatus === EXPIRED_CLEANED ? 'expired_cleanup' : (session.lastError || null),
      },
    })

    if (finalUpdate.count === 0) {
      // Session claimed by another process between delete and final update — do not retry
      logger.warn('[blob-upload-cleanup] final state changed concurrently')
      continue
    }

    if (finalStatus === EXPIRED_CLEANED) {
      stats.expiredCleaned++
    } else {
      stats.rejected++
    }
  }

  return stats
}
