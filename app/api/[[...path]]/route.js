import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import {
  adminModerationSchema,
  adminPasswordSchema,
  createEventSchema,
  MAX_CHUNK_SIZE_BYTES,
  uploadChunkSchema,
  uploadCompleteSchema,
  uploadInitSchema,
} from '@/lib/server/schemas'
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  getAdminAuthStatus,
  getAdminCookieOptions,
  setupLocalAdminPassword,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from '@/lib/server/admin-auth'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { localStorageDriver } from '@/lib/server/storage/local-storage'

export const runtime = 'nodejs'

const json = (payload, status = 200) => {
  const response = NextResponse.json(payload, { status })
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return response
}

const formatZodError = (error) => {
  return error.issues?.map((issue) => issue.message).join(', ') || 'Invalid request payload'
}

const getSegments = (params) => params?.path || []

const getAdminAuthentication = async (request) => {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  return verifyAdminSessionToken(token)
}

const requireAdmin = async (request) => {
  const authenticated = await getAdminAuthentication(request)
  return authenticated ? null : json({ error: 'Admin authentication required' }, 401)
}

const setAdminSessionCookie = async (response) => {
  response.cookies.set(ADMIN_COOKIE_NAME, await createAdminSessionToken(), getAdminCookieOptions())
  return response
}

const clearAdminSessionCookie = (response) => {
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    ...getAdminCookieOptions(),
    maxAge: 0,
  })
  return response
}

const routeRoot = async () => {
  const adminStatus = await getAdminAuthStatus()

  return json({
    name: 'Event Gallery MVP API',
    repositoryMode: process.env.DATABASE_URL ? 'prisma-or-local-fallback' : 'local-fallback',
    storageMode: localStorageDriver.mode,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    adminConfigured: adminStatus.configured,
    adminSource: adminStatus.source,
  })
}

const createEvent = async (request) => {
  const payload = createEventSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const event = await repository.createEvent(payload)
  return json({ event }, 201)
}

const listEvents = async () => {
  const repository = await getGalleryRepository()
  const events = await repository.listEvents()
  return json({ events })
}

const getEvent = async (slug, options = {}) => {
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug, options)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  return json({ event })
}

const initUpload = async (request) => {
  const payload = uploadInitSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(payload.eventSlug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const session = await localStorageDriver.initUploadSession(payload)
  return json({ session }, 201)
}

const uploadChunk = async (request) => {
  const formData = await request.formData()
  const chunk = formData.get('chunk')
  const parsed = uploadChunkSchema.parse({
    sessionId: String(formData.get('sessionId') || ''),
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

  await localStorageDriver.saveChunk({
    sessionId: parsed.sessionId,
    chunkIndex: parsed.chunkIndex,
    chunkBuffer,
  })

  return json({ uploaded: true, chunkIndex: parsed.chunkIndex, totalChunks: parsed.totalChunks })
}

const completeUpload = async (request) => {
  const payload = uploadCompleteSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const fileResult = await localStorageDriver.completeUploadSession({
    sessionId: payload.sessionId,
    photoId: randomUUID(),
  })

  const event = await repository.getEventBySlug(fileResult.eventSlug)

  if (!event) {
    return json({ error: 'Event not found while finalizing upload' }, 404)
  }

  const photo = await repository.createPhoto({
    eventId: event.id,
    originalName: fileResult.originalName,
    storedName: fileResult.storedName,
    mimeType: fileResult.mimeType,
    size: fileResult.size,
    url: fileResult.url,
    uploaderName: payload.uploaderName,
    caption: payload.caption,
  })

  const freshEvent = await repository.getEventBySlug(event.slug)

  return json({
    photo,
    event: freshEvent,
  }, 201)
}

const getAdminConfig = async () => {
  const adminStatus = await getAdminAuthStatus()
  return json(adminStatus)
}

const getAdminSession = async (request) => {
  const adminStatus = await getAdminAuthStatus()
  const authenticated = await getAdminAuthentication(request)

  return json({
    ...adminStatus,
    authenticated,
  })
}

const setupAdmin = async (request) => {
  const payload = adminPasswordSchema.parse(await request.json())
  const adminStatus = await setupLocalAdminPassword(payload.password)
  const response = json({
    ...adminStatus,
    authenticated: true,
  }, 201)

  return setAdminSessionCookie(response)
}

const loginAdmin = async (request) => {
  const payload = adminPasswordSchema.parse(await request.json())
  const isValid = await verifyAdminPassword(payload.password)

  if (!isValid) {
    return json({ error: 'Invalid admin password' }, 401)
  }

  const adminStatus = await getAdminAuthStatus()
  const response = json({
    ...adminStatus,
    authenticated: true,
  })

  return setAdminSessionCookie(response)
}

const logoutAdmin = async () => {
  return clearAdminSessionCookie(json({ authenticated: false, loggedOut: true }))
}

const listAdminEvents = async (request) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  return listEvents()
}

const createAdminEvent = async (request) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  return createEvent(request)
}

const getAdminEvent = async (request, slug) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  return getEvent(slug, { includeHidden: true })
}

const moderatePhoto = async (request, photoId) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  const payload = adminModerationSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const photo = await repository.setPhotoStatus(photoId, payload.action === 'approve' ? 'VISIBLE' : 'HIDDEN')

  if (!photo) {
    return json({ error: 'Photo not found' }, 404)
  }

  return json({ photo })
}

const deletePhoto = async (request, photoId) => {
  const authError = await requireAdmin(request)

  if (authError) {
    return authError
  }

  const repository = await getGalleryRepository()
  const photo = await repository.deletePhoto(photoId)

  if (!photo) {
    return json({ error: 'Photo not found' }, 404)
  }

  await localStorageDriver.deleteStoredFile(photo.url)
  return json({ deleted: true, photo })
}

export async function OPTIONS() {
  return json({ ok: true })
}

async function handleRoute(request, { params }) {
  const segments = getSegments(params)
  const method = request.method

  try {
    if (segments.length === 0 && method === 'GET') {
      return routeRoot()
    }

    if (segments[0] === 'admin') {
      if (segments.length === 2 && segments[1] === 'config' && method === 'GET') {
        return getAdminConfig()
      }

      if (segments.length === 2 && segments[1] === 'session' && method === 'GET') {
        return getAdminSession(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'POST') {
        return setupAdmin(request)
      }

      if (segments.length === 2 && segments[1] === 'login' && method === 'POST') {
        return loginAdmin(request)
      }

      if (segments.length === 2 && segments[1] === 'logout' && method === 'POST') {
        return logoutAdmin()
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'GET') {
        return listAdminEvents(request)
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'POST') {
        return createAdminEvent(request)
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'GET') {
        return getAdminEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'PATCH') {
        return moderatePhoto(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'DELETE') {
        return deletePhoto(request, segments[2])
      }
    }

    if (segments[0] === 'events') {
      if (segments.length === 1 && method === 'GET') {
        return listEvents()
      }

      if (segments.length === 1 && method === 'POST') {
        return createEvent(request)
      }

      if (segments.length === 2 && method === 'GET') {
        return getEvent(segments[1])
      }
    }

    if (segments[0] === 'uploads' && segments[1] === 'init' && method === 'POST') {
      return initUpload(request)
    }

    if (segments[0] === 'uploads' && segments[1] === 'chunk' && method === 'POST') {
      return uploadChunk(request)
    }

    if (segments[0] === 'uploads' && segments[1] === 'complete' && method === 'POST') {
      return completeUpload(request)
    }

    return json({ error: `Route /${segments.join('/')} not found` }, 404)
  } catch (error) {
    console.error('Event gallery API error:', error)

    if (error?.issues) {
      return json({ error: formatZodError(error) }, 400)
    }

    return json({ error: error?.message || 'Internal server error' }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PATCH = handleRoute
export const DELETE = handleRoute
