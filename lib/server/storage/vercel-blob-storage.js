import path from 'path'
import { randomUUID } from 'crypto'
import { del } from '@vercel/blob'

const sanitizeName = (value = 'upload') => {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || 'upload'
}

export const isVercelBlobStorageConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)

/**
 * MIME type to canonical extension mapping.
 * When a MIME type is present in this map its extension is always used,
 * overriding whatever the client supplied as the file extension.
 * This prevents percent-encoded or otherwise malformed extensions from
 * reaching the blob pathname.
 */
const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/**
 * Returns a safe, lowercase extension for the given file and MIME type.
 *
 * Priority:
 * 1. If mimeType is in EXTENSION_BY_MIME, use that extension.
 * 2. Otherwise use path.extname(fileName) if it matches /^\.[a-zA-Z0-9]{1,10}$/.
 * 3. Otherwise return '' (no extension).
 */
function safeExtension(fileName, mimeType) {
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (EXTENSION_BY_MIME[normalizedMime]) {
    return EXTENSION_BY_MIME[normalizedMime]
  }
  const ext = path.extname(fileName).toLowerCase()
  return /^\.[a-zA-Z0-9]{1,10}$/.test(ext) ? ext : ''
}

export const buildBlobPathname = ({ eventSlug, fileName, mimeType }) => {
  const ext = safeExtension(fileName, mimeType)
  const safeBaseName = sanitizeName(path.basename(fileName, path.extname(fileName)))
  return `events/${eventSlug}/${randomUUID()}-${safeBaseName}${ext}`
}

export const buildPrivateDeliveryBlobPathname = ({ eventSlug, fileName, mimeType }) => {
  const ext = safeExtension(fileName, mimeType)
  const safeBaseName = sanitizeName(path.basename(fileName, path.extname(fileName)))
  return `private-delivery/${eventSlug}/${randomUUID()}-${safeBaseName}${ext}`
}

export const getStoredNameFromBlobPathname = (pathname = '') => {
  return pathname.split('/').filter(Boolean).pop() || pathname
}

export const vercelBlobStorageDriver = {
  mode: 'vercel-blob',

  /**
   * Returns a descriptor for a server-bound Vercel Blob upload.
   *
   * The caller (createServerBoundBlobUploadInit) must provide:
   * - sessionId: the BlobUploadSession.id already persisted to the database
   * - expectedPathname: the pathname that was stored in the database session
   * - handleUploadUrl: the server-side token-issuance endpoint (relative, /api/...)
   *
   * This function does NOT generate sessionId or expectedPathname. All
   * generation is done by createServerBoundBlobUploadInit before calling here.
   */
  async initUploadSession({ sessionId, expectedPathname, handleUploadUrl }) {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('initUploadSession: sessionId is required')
    }
    if (!expectedPathname || typeof expectedPathname !== 'string') {
      throw new Error('initUploadSession: expectedPathname is required')
    }
    if (!handleUploadUrl || typeof handleUploadUrl !== 'string') {
      throw new Error('initUploadSession: handleUploadUrl is required')
    }
    if (!handleUploadUrl.startsWith('/api/')) {
      throw new Error('initUploadSession: handleUploadUrl must start with /api/')
    }
    if (handleUploadUrl.includes('://') || handleUploadUrl.includes('\\')) {
      throw new Error('initUploadSession: handleUploadUrl must be a relative path without protocol or backslash')
    }
    if (handleUploadUrl.includes('#') || handleUploadUrl.includes('?')) {
      throw new Error('initUploadSession: handleUploadUrl must not contain query parameters or fragment')
    }

    return {
      sessionId,
      storageMode: 'vercel-blob',
      uploadStrategy: 'vercel-blob-client',
      handleUploadUrl,
      pathname: expectedPathname,
    }
  },

  async deleteStoredFile(url) {
    if (!url || !url.startsWith('http')) {
      return
    }

    await del(url)
  },
}
