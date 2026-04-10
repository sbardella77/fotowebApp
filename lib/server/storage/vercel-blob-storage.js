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

export const buildBlobPathname = ({ eventSlug, fileName }) => {
  const extension = path.extname(fileName)
  const safeBaseName = sanitizeName(path.basename(fileName, extension))
  return `events/${eventSlug}/${randomUUID()}-${safeBaseName}${extension}`
}

export const getStoredNameFromBlobPathname = (pathname = '') => {
  return pathname.split('/').filter(Boolean).pop() || pathname
}

export const vercelBlobStorageDriver = {
  mode: 'vercel-blob',

  async initUploadSession({ eventSlug, fileName }) {
    return {
      sessionId: randomUUID(),
      storageMode: 'vercel-blob',
      uploadStrategy: 'vercel-blob-client',
      handleUploadUrl: '/api/uploads/blob',
      pathname: buildBlobPathname({ eventSlug, fileName }),
    }
  },

  async deleteStoredFile(url) {
    if (!url || !url.startsWith('http')) {
      return
    }

    await del(url)
  },
}
