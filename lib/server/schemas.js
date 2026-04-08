import { z } from 'zod'

export const MAX_CHUNK_SIZE_BYTES = 1024 * 1024
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

export const slugify = (value = '') => {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48)
}

export const createEventSchema = z.object({
  name: z.string().trim().min(3, 'Event name must be at least 3 characters').max(80),
})

export const uploadInitSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine((value) => value.startsWith('image/'), 'Only image uploads are allowed'),
  totalChunks: z.number().int().min(1).max(1000),
})

export const uploadChunkSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  chunkIndex: z.number().int().min(0).max(999),
  totalChunks: z.number().int().min(1).max(1000),
})

export const uploadCompleteSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  uploaderName: z.string().trim().max(60).optional().or(z.literal('')),
  caption: z.string().trim().max(140).optional().or(z.literal('')),
})
