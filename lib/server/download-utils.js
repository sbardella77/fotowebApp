import { readFile } from 'fs/promises'
import path from 'path'
import { applyWatermark } from './watermark'

export { applyWatermark }

/**
 * Defense in depth against SSRF: only fetch remote photos from the
 * expected Vercel Blob storage hosts.
 */
const isAllowedRemotePhotoUrl = (photoUrl) => {
  try {
    const parsed = new URL(photoUrl)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.blob.vercel-storage.com')
  } catch {
    return false
  }
}

/**
 * Fetch a photo buffer from its URL.
 * Supports both Vercel Blob (HTTPS) and local storage.
 */
export async function getPhotoBuffer(photoUrl) {
  if (!photoUrl) {
    throw new Error('Photo URL is required')
  }

  // Vercel Blob: fetch via HTTP
  if (photoUrl.startsWith('http')) {
    if (!isAllowedRemotePhotoUrl(photoUrl)) {
      throw new Error('Photo URL host is not allowed')
    }
    const response = await fetch(photoUrl, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Failed to fetch photo: ${response.status} ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  // Local storage: read from disk
  const relativePath = photoUrl.replace(/^\/+/, '')
  const filePath = path.join(process.cwd(), 'public', relativePath)
  return readFile(filePath)
}

/**
 * Process a photo for download: optionally apply watermark.
 *
 * `watermarkOptions` is passed straight through to applyWatermark. Callers
 * that omit it keep the default preserve-the-input-container behavior.
 */
export async function processPhotoForDownload({ photoUrl, branded, fileName, watermarkOptions }) {
  const buffer = await getPhotoBuffer(photoUrl)

  if (branded) {
    const watermarked = await applyWatermark(buffer, watermarkOptions)
    return { buffer: watermarked, fileName }
  }

  return { buffer, fileName }
}

/**
 * Determine the download file name for a photo.
 *
 * `extension` (e.g. '.jpg') overrides the source extension — required when
 * the response body has been transcoded, so the filename never advertises a
 * format the bytes are not.
 */
export function getDownloadFileName(photo, { suffix = '', extension } = {}) {
  const baseName = photo.originalName || photo.storedName || 'photo'
  // path.parse gives the TRAILING extension. The previous
  // baseName.replace(ext, '') stripped the first matching substring
  // anywhere, corrupting names like '.jpg-holiday.jpg'.
  const parsed = path.parse(baseName)
  const ext = extension || parsed.ext || '.jpg'
  return `${parsed.name}${suffix}${ext}`
}
