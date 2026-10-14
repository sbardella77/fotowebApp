import { uploadChunkSchema, MAX_CHUNK_SIZE_BYTES } from '@/lib/server/schemas'
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/server/rate-limiter'
import { readSessionMeta, getReceivedChunkSize } from '@/lib/server/storage/local-storage'
import { localStorageDriver } from '@/lib/server/storage'
import { json } from '@/lib/server/api-response'

export const runtime = 'nodejs'

// Moved verbatim out of the legacy app/api/[[...path]]/route.js catch-all
// (previously `uploadChunk`). Behavior, status codes, and rate limiting are
// unchanged — deliberately NOT wrapped in a generic try/catch; see the
// comment on app/api/uploads/init/route.js for why that matches the
// original's behavior.
export async function POST(request) {
  const clientIp = getClientIp(request)
  const limit = rateLimit(`upload-chunk:ip:${clientIp}`, RATE_LIMITS.uploadChunk.ip.max, RATE_LIMITS.uploadChunk.ip.window)
  if (limit.limited) {
    return json({ error: 'Too many upload chunks. Please try again later.' }, 429)
  }

  const formData = await request.formData()
  const chunk = formData.get('chunk')
  const parsed = uploadChunkSchema.parse({
    sessionId: String(formData.get('sessionId') || ''),
    uploadToken: String(formData.get('uploadToken') || ''),
    chunkIndex: Number(formData.get('chunkIndex')),
    totalChunks: Number(formData.get('totalChunks')),
  })

  if (!(chunk instanceof File)) {
    return json({ error: 'chunk file is required' }, 400)
  }

  const chunkBuffer = Buffer.from(await chunk.arrayBuffer())

  if (chunkBuffer.byteLength > MAX_CHUNK_SIZE_BYTES) {
    return json({ error: 'Chunk exceeds server limit' }, 400)
  }

  // Validate session exists and enforce cumulative size limit
  let meta
  try {
    meta = await readSessionMeta(parsed.sessionId)
  } catch {
    return json({ error: 'Upload session not found or expired' }, 400)
  }

  // meta.uploadToken is absent only on sessions created before this check
  // existed (in-flight across a deploy) — never block those retroactively.
  if (meta.uploadToken && meta.uploadToken !== parsed.uploadToken) {
    return json({ error: 'Invalid upload session' }, 403)
  }

  const receivedSoFar = await getReceivedChunkSize(parsed.sessionId)
  if (receivedSoFar + chunkBuffer.length > meta.fileSize) {
    return json({ error: 'Cumulative chunk size exceeds declared file size' }, 413)
  }

  await localStorageDriver.saveChunk({
    sessionId: parsed.sessionId,
    chunkIndex: parsed.chunkIndex,
    chunkBuffer,
  })

  return json({ uploaded: true, chunkIndex: parsed.chunkIndex, totalChunks: parsed.totalChunks })
}

export async function OPTIONS() {
  return json({ ok: true })
}
