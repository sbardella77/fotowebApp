import { z } from 'zod'

export const MAX_CHUNK_SIZE_BYTES = 1024 * 1024
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const MIN_ADMIN_PASSWORD_LENGTH = 8

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

const imageMimeTypeValidator = (value) => ALLOWED_IMAGE_MIME_TYPES.includes(value.toLowerCase())

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
  ownerEmail: z.string().trim().email('A valid email is required').max(120).optional().or(z.literal('')),
})

export const uploadInitSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine(imageMimeTypeValidator, 'Only image uploads are allowed'),
  totalChunks: z.number().int().min(1).max(1000),
})

export const uploadChunkSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  chunkIndex: z.number().int().min(0).max(999),
  totalChunks: z.number().int().min(1).max(1000),
})

export const localUploadCompleteSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  uploaderName: z.string().trim().max(60).optional().or(z.literal('')),
  caption: z.string().trim().max(140).optional().or(z.literal('')),
})

export const blobUploadClientPayloadSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine(imageMimeTypeValidator, 'Only image uploads are allowed'),
})

export const blobUploadCompleteSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  blobUrl: z.string().url(),
  blobPathname: z.string().trim().min(3).max(300),
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(100).refine(imageMimeTypeValidator, 'Only image uploads are allowed'),
  size: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  uploaderName: z.string().trim().max(60).optional().or(z.literal('')),
  caption: z.string().trim().max(140).optional().or(z.literal('')),
})

export const adminPasswordSchema = z.object({
  password: z.string().min(MIN_ADMIN_PASSWORD_LENGTH, `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`).max(120),
})

export const saveOwnerEmailSchema = z.object({
  email: z.string().trim().email('A valid email is required').max(120),
})

export const updateEventSchema = z.object({
  name: z.string().trim().min(3, 'Room name must be at least 3 characters').max(80),
})

export const adminModerationSchema = z.object({
  action: z.enum(['approve', 'reject']),
})
