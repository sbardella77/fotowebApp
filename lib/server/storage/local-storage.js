import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

const STORAGE_ROOT = path.join(process.cwd(), 'public', 'uploads')
const TEMP_ROOT = path.join(process.cwd(), 'data', 'uploads', 'tmp')

const sanitizeName = (value = 'upload') => {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || 'upload'
}

const sessionDirectory = (sessionId) => path.join(TEMP_ROOT, sessionId)
const sessionMetaFile = (sessionId) => path.join(sessionDirectory(sessionId), 'meta.json')
const sessionChunkFile = (sessionId, chunkIndex) => path.join(sessionDirectory(sessionId), `${chunkIndex}.part`)

const readSessionMeta = async (sessionId) => {
  const content = await readFile(sessionMetaFile(sessionId), 'utf8')
  return JSON.parse(content)
}

export const localStorageDriver = {
  mode: 'local',

  async initUploadSession({ eventSlug, fileName, fileSize, mimeType, totalChunks }) {
    const sessionId = randomUUID()
    const directory = sessionDirectory(sessionId)

    await mkdir(directory, { recursive: true })

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
    await mkdir(sessionDirectory(sessionId), { recursive: true })
    await writeFile(sessionChunkFile(sessionId, chunkIndex), chunkBuffer)
  },

  async completeUploadSession({ sessionId, photoId }) {
    const meta = await readSessionMeta(sessionId)
    const extension = path.extname(meta.fileName)
    const safeBaseName = sanitizeName(path.basename(meta.fileName, extension))
    const storedName = `${photoId}-${safeBaseName}${extension}`
    const eventDirectory = path.join(STORAGE_ROOT, 'events', meta.eventSlug)
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
      originalName: meta.fileName,
      storedName,
      mimeType: meta.mimeType,
      size: fileStats.size,
      url: `/uploads/events/${meta.eventSlug}/${storedName}`,
      storageMode: 'local',
    }
  },
}
