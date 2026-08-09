import { z } from 'zod'

export const MAX_CHUNK_SIZE_BYTES = 1024 * 1024
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
export const MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES = 100 * 1024 * 1024
export const MIN_ADMIN_PASSWORD_LENGTH = 8

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

export const ALLOWED_PRIVATE_DELIVERY_MIME_TYPES = [
  'image/jpeg',
  'image/png',
]

const imageMimeTypeValidator = (value) => ALLOWED_IMAGE_MIME_TYPES.includes(value.toLowerCase())
const privateDeliveryMimeTypeValidator = (value) => ALLOWED_PRIVATE_DELIVERY_MIME_TYPES.includes(value.toLowerCase())

// SSRF guard: blob URLs must point to Vercel Blob storage (or be local paths).
const blobUrlValidator = (value) => {
  if (value.startsWith('/')) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.blob.vercel-storage.com')
  } catch {
    return false
  }
}

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
  sessionId: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9-]+$/, 'Invalid upload session id'),
  chunkIndex: z.number().int().min(0).max(999),
  totalChunks: z.number().int().min(1).max(1000),
})

export const localUploadCompleteSchema = z.object({
  sessionId: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9-]+$/, 'Invalid upload session id'),
  uploaderName: z.string().trim().max(60).optional().or(z.literal('')),
  caption: z.string().trim().max(140).optional().or(z.literal('')),
  momentId: z.string().trim().min(1).max(60).optional().or(z.literal('')),
})

export const blobUploadClientPayloadSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine(imageMimeTypeValidator, 'Only image uploads are allowed'),
})

export const blobUploadCompleteSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  blobUrl: z.string().refine(blobUrlValidator, 'Invalid blob URL'),
  blobPathname: z.string().trim().min(3).max(300),
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(100).refine(imageMimeTypeValidator, 'Only image uploads are allowed'),
  size: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  uploaderName: z.string().trim().max(60).optional().or(z.literal('')),
  caption: z.string().trim().max(140).optional().or(z.literal('')),
  momentId: z.string().trim().min(1).max(60).optional().or(z.literal('')),
})

export const blobUploadSessionCompleteSchema = z
  .object({
    sessionId: z
      .string()
      .trim()
      .min(8)
      .max(120)
      .regex(
        /^[a-zA-Z0-9_-]+$/,
        'Invalid upload session id',
      ),
  })
  .strict()

export const privateDeliveryUploadInitSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine(privateDeliveryMimeTypeValidator, 'Only JPEG and PNG uploads are allowed for private delivery'),
  totalChunks: z.number().int().min(1).max(1000),
})

export const privateDeliveryBlobUploadClientPayloadSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  fileName: z.string().trim().min(1).max(180),
  fileSize: z.number().int().positive().max(MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES),
  mimeType: z.string().trim().min(3).max(100).refine(privateDeliveryMimeTypeValidator, 'Only JPEG and PNG uploads are allowed for private delivery'),
})

export const privateDeliveryBlobUploadCompleteSchema = z.object({
  eventSlug: z.string().trim().min(2).max(60),
  blobUrl: z.string().refine(blobUrlValidator, 'Invalid blob URL'),
  blobPathname: z.string().trim().min(3).max(300),
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(3).max(100).refine(privateDeliveryMimeTypeValidator, 'Only JPEG and PNG uploads are allowed for private delivery'),
  size: z.number().int().positive().max(MAX_PRIVATE_DELIVERY_FILE_SIZE_BYTES),
})

export const privateDeliveryLocalUploadCompleteSchema = z.object({
  sessionId: z.string().trim().min(8).max(120).regex(/^[a-zA-Z0-9-]+$/, 'Invalid upload session id'),
})

export const adminPasswordSchema = z.object({
  password: z.string().min(MIN_ADMIN_PASSWORD_LENGTH, `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`).max(120),
})

export const saveOwnerEmailSchema = z.object({
  email: z.string().trim().email('A valid email is required').max(120),
})

export const updateEventSchema = z.object({
  name: z.string().trim().min(3, 'Room name must be at least 3 characters').max(80).optional(),
  coverUrl: z.string().url().optional().nullable(),
})

export const adminModerationSchema = z.object({
  action: z.enum(['approve', 'reject']),
})
