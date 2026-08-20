import { BlobUploadKind } from '@prisma/client'
import { createBlobUploadSession } from './blob-upload-session.js'
import {
  buildBlobPathname,
  buildPrivateDeliveryBlobPathname,
} from './storage/vercel-blob-storage.js'

/**
 * Creates a server-bound Vercel Blob upload session.
 *
 * Orchestrates the two-step init process:
 * 1. Persists a BlobUploadSession record (via lifecycle service) that binds
 *    expectedPathname to the event before the client receives any token.
 * 2. Delegates to storageDriver.initUploadSession() with only the fields the
 *    driver needs: sessionId, expectedPathname, handleUploadUrl.
 *
 * The sessionId returned to the browser is exactly BlobUploadSession.id,
 * establishing the binding that the subsequent token-issuance handler will
 * verify.
 *
 * Constraints:
 * - Only supports storageDriver.mode === 'vercel-blob'.
 * - Does not support local storage driver.
 * - Does not create network connections or call Vercel Blob APIs directly.
 * - Does not import getPrismaClient().
 */
export async function createServerBoundBlobUploadInit({
  prisma,
  storageDriver,
  event,
  payload,
  uploadKind,
  handleUploadUrl,
  uploaderName,
  caption,
  momentId,
  contributorId,
}) {
  if (
    !prisma ||
    typeof prisma.blobUploadSession !== 'object' ||
    prisma.blobUploadSession === null
  ) {
    throw new Error(
      'createServerBoundBlobUploadInit: prisma.blobUploadSession delegate is required',
    )
  }
  if (!storageDriver || storageDriver.mode !== 'vercel-blob') {
    throw new Error(
      'createServerBoundBlobUploadInit: storageDriver must be in vercel-blob mode',
    )
  }
  if (!event || !event.id || !event.slug) {
    throw new Error(
      'createServerBoundBlobUploadInit: event.id and event.slug are required',
    )
  }
  if (!payload || !payload.fileName || !payload.fileSize || !payload.mimeType) {
    throw new Error(
      'createServerBoundBlobUploadInit: payload must contain fileName, fileSize, and mimeType',
    )
  }
  if (!handleUploadUrl) {
    throw new Error('createServerBoundBlobUploadInit: handleUploadUrl is required')
  }

  // Build expected pathname using MIME-safe extension
  const pathBuilder =
    uploadKind === BlobUploadKind.ROOM_PHOTO
      ? buildBlobPathname
      : buildPrivateDeliveryBlobPathname

  const expectedPathname = pathBuilder({
    eventSlug: event.slug,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
  })

  // Persist the session — this is the authoritative record for subsequent
  // token issuance and completion verification
  const databaseSession = await createBlobUploadSession(prisma, {
    eventId: event.id,
    eventSlug: event.slug,
    uploadKind,
    expectedPathname,
    originalName: payload.fileName,
    mimeType: payload.mimeType,
    expectedSize: payload.fileSize,
    uploaderName: uploaderName ?? null,
    caption: caption ?? null,
    momentId: momentId ?? null,
    contributorId: contributorId ?? null,
  })

  // Delegate to storage driver with only the three fields it needs
  return storageDriver.initUploadSession({
    sessionId: databaseSession.id,
    expectedPathname: databaseSession.expectedPathname,
    handleUploadUrl,
  })
}
