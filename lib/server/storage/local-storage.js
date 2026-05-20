import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const STORAGE_ROOT = path.join(process.cwd(), 'public', 'uploads')
const TEMP_ROOT = path.join(process.cwd(), 'data', 'uploads', 'tmp')

const assertWritableLocalStorage = () => {
  if (process.env.VERCEL) {
    throw new Error('Local file storage is not supported on Vercel. Keep read-only gallery/admin flows live, but configure object storage before enabling photo uploads in production.')
  }
}

const sanitizeName = (value = 'upload') => {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || 'upload'
}

const sessionDirectory = (sessionId) => path.join(TEMP_ROOT, sessionId)
const sessionMetaFile = (sessionId) => path.join(sessionDirectory(sessionId), 'meta.json')
const sessionChunkFile = (sessionId, chunkIndex) => path.join(sessionDirectory(sessionId), `${chunkIndex}.part`)

export const readSessionMeta = async (sessionId) => {
  const content = await readFile(sessionMetaFile(sessionId), 'utf8')
  return JSON.parse(content)
}

const getReceivedChunkSize = async (sessionId) => {
  const dir = sessionDirectory(sessionId)
  try {
    const entries = await readdir(dir)
    let total = 0
    for (const entry of entries) {
      if (entry.endsWith('.part')) {
        const s = await stat(path.join(dir, entry))
        total += s.size
      }
    }
    return total
  } catch {
    return 0
  }
}

export { getReceivedChunkSize }

export const localStorageDriver = {
  mode: 'local',

  async initUploadSession({ eventSlug, fileName, fileSize, mimeType, totalChunks, directory = 'events' }) {
    assertWritableLocalStorage()

    const sessionId = randomUUID()
    const dir = sessionDirectory(sessionId)

    await mkdir(dir, { recursive: true })

    await writeFile(
      sessionMetaFile(sessionId),
      JSON.stringify(
        {
          sessionId,
          eventSlug,
          fileName,
          fileSize,
          mimeType,
          totalChunks,
          directory,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    )

    return {
      sessionId,
      chunkSize: 1024 * 1024,
      storageMode: 'local',
    }
  },

  async saveChunk({ sessionId, chunkIndex, chunkBuffer }) {
    assertWritableLocalStorage()

    await mkdir(sessionDirectory(sessionId), { recursive: true })
    await writeFile(sessionChunkFile(sessionId, chunkIndex), chunkBuffer)
  },

  async completeUploadSession({ sessionId, photoId }) {
    assertWritableLocalStorage()

    const meta = await readSessionMeta(sessionId)
    const extension = path.extname(meta.fileName)
    const safeBaseName = sanitizeName(path.basename(meta.fileName, extension))
    const storedName = `${photoId}-${safeBaseName}${extension}`
    const eventDirectory = path.join(STORAGE_ROOT, meta.directory || 'events', meta.eventSlug)
    const finalFilePath = path.join(eventDirectory, storedName)

    await mkdir(eventDirectory, { recursive: true })
    await writeFile(finalFilePath, Buffer.alloc(0))

    for (let index = 0; index < meta.totalChunks; index += 1) {
      const chunkPath = sessionChunkFile(sessionId, index)
      const chunkBuffer = await readFile(chunkPath)
      await appendFile(finalFilePath, chunkBuffer)
    }

    const fileStats = await stat(finalFilePath)
    await rm(sessionDirectory(sessionId), { recursive: true, force: true })

    return {
      eventSlug: meta.eventSlug,
      originalName: meta.fileName,
      storedName,
      mimeType: meta.mimeType,
      size: fileStats.size,
      url: `/uploads/${meta.directory || 'events'}/${meta.eventSlug}/${storedName}`,
      storageMode: 'local',
    }
  },

  async deleteStoredFile(url) {
    if (!url) {
      return
    }

    const relativePath = url.replace(/^\/+/, '')
    const filePath = path.join(process.cwd(), 'public', relativePath)
    await rm(filePath, { force: true })
  },
}
