import { ensureDisplayDerivative } from '@/lib/server/display-derivative'
import { getPhotoBuffer } from '@/lib/server/download-utils'
import { serializeProviderError } from '@/lib/server/safe-log'

/**
 * Ensure the display derivative exists for a photo AND record the
 * resulting Photo.displayDerivativeStatus (TASK-02).
 *
 * Extracted from app/api/[[...path]]/route.js's original inline
 * ensurePhotoDisplayDerivative (TASK-02) so the SAME logic can be shared
 * by the eager upload/moderation call sites and the legacy backfill
 * (TASK-03 Phase 1A) without duplicating the READY/FAILED bookkeeping or
 * its error-sanitization contract. route.js's own ensurePhotoDisplayDerivative
 * now delegates here unchanged in behavior.
 *
 * A failure here is cache/status materialization failing, not the
 * Photo write failing — it must never be allowed to turn a successful
 * upload, moderation decision, or backfill batch item into a hard
 * failure for its caller, so every error is caught here and never
 * rethrown.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {{id: string, url: string}} params.photo
 * @param {string} params.operation   log label only — never logged with
 *   anything sensitive alongside it.
 * @param {Buffer} [params.sourceBuffer]  already-fetched+validated buffer
 *   (upload-completion fast path); omitted everywhere else, which falls
 *   back to fetching photo.url server-side.
 * @param {() => Promise<Buffer>} [params.getSourceBuffer]  full override of
 *   the source-buffer fetch, for callers (e.g. the backfill) that want to
 *   control it directly without threading sourceBuffer/photo.url.
 * @returns {Promise<{created: boolean, status: 'READY'|'FAILED'}>}
 *   `created` matches ensureDisplayDerivative's own contract (true only
 *   when THIS call's transform+put produced the object). `status` is the
 *   displayDerivativeStatus value this call attempted to record — callers
 *   that need per-item outcome reporting (the backfill) read this instead
 *   of re-querying the row.
 */
export async function ensurePhotoDisplayDerivativeStatus({ prisma, photo, operation, sourceBuffer, getSourceBuffer }) {
  try {
    const result = await ensureDisplayDerivative({
      photoId: photo.id,
      getSourceBuffer: getSourceBuffer || (sourceBuffer ? async () => sourceBuffer : () => getPhotoBuffer(photo.url)),
    })
    // READY means only this: a display derivative is confirmed to exist as
    // the output of this pipeline (fresh transform+put, or a prior run's
    // already-persisted object) — never inferred from anything else.
    await prisma?.photo?.updateMany?.({
      where: { id: photo.id },
      data: { displayDerivativeStatus: 'READY' },
    })?.catch((updateError) => {
      console.warn(`[${operation}] Failed to record READY display derivative status for photo:`, photo.id, serializeProviderError('db', 'record_display_derivative_ready', updateError))
    })
    return { created: result.created, status: 'READY' }
  } catch (error) {
    // Safe context only: photoId (opaque) and the operation label. Never
    // the source URL, storedName, originalName, or the raw error object.
    console.warn(`[${operation}] Display derivative generation failed for photo:`, photo.id, serializeProviderError('blob', 'ensure_photo_display_derivative', error))
    await prisma?.photo?.updateMany?.({
      where: { id: photo.id },
      data: { displayDerivativeStatus: 'FAILED' },
    })?.catch((updateError) => {
      console.warn(`[${operation}] Failed to record FAILED display derivative status for photo:`, photo.id, serializeProviderError('db', 'record_display_derivative_failed', updateError))
    })
    return { created: false, status: 'FAILED' }
  }
}
