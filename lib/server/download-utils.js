import { readFile } from 'fs/promises'
import path from 'path'
import { applyWatermark } from './watermark'

export { applyWatermark }

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
 */
export async function processPhotoForDownload({ photoUrl, branded, fileName }) {
  const buffer = await getPhotoBuffer(photoUrl)

  if (branded) {
    const watermarked = await applyWatermark(buffer)
    return { buffer: watermarked, fileName }
  }

  return { buffer, fileName }
}

/**
 * Determine the download file name for a photo.
 */
export function getDownloadFileName(photo, { suffix = '' } = {}) {
  const baseName = photo.originalName || photo.storedName || 'photo'
  const ext = path.extname(baseName) || '.jpg'
  const nameWithoutExt = baseName.replace(ext, '')
  return `${nameWithoutExt}${suffix}${ext}`
}
