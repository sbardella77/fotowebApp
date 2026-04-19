import { randomUUID } from 'crypto'
import { handleUpload } from '@vercel/blob/client'
import {
  generateManagementToken,
  hashManagementToken,
  verifyManagementToken,
} from '@/lib/server/management-token'
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import {
  adminModerationSchema,
  adminPasswordSchema,
  blobUploadClientPayloadSchema,
  blobUploadCompleteSchema,
  createEventSchema,
  localUploadCompleteSchema,
  MAX_CHUNK_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  saveOwnerEmailSchema,
  updateEventSchema,
  uploadChunkSchema,
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
import {
  OWNER_COOKIE_NAME,
  createOwnerSessionToken,
  createRecoveryToken,
  createSetupToken,
  getOwnerCookieOptions,
  verifyOwnerSessionToken,
  verifyRecoveryToken,
  verifySetupToken,
} from '@/lib/server/owner-auth'
import { getGalleryRepository, getGalleryRepositoryMode } from '@/lib/server/gallery-repository'
import { createPasswordHash, verifyPassword, validatePassword } from '@/lib/server/owner-password'
import { getAdminAuthDriver, getDataAccessDriver } from '@/lib/server/prisma-client'
import {
  buildBlobPathname,
  deleteStoredFile,
  getStoredNameFromBlobPathname,
  getStorageDriver,
  getStorageMode,
  isVercelBlobStorageConfigured,
  localStorageDriver,
} from '@/lib/server/storage'

export const runtime = 'nodejs'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

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

const getOwnerAuthentication = async (request) => {
  const token = request.cookies.get(OWNER_COOKIE_NAME)?.value
  return verifyOwnerSessionToken(token)
}

const requireOwner = async (request) => {
  const email = await getOwnerAuthentication(request)
  return email ? email : json({ error: 'Owner authentication required' }, 401)
}

const setOwnerSessionCookie = async (response, email) => {
  response.cookies.set(OWNER_COOKIE_NAME, await createOwnerSessionToken(email), getOwnerCookieOptions())
  return response
}

const clearOwnerSessionCookie = (response) => {
  response.cookies.set(OWNER_COOKIE_NAME, '', {
    ...getOwnerCookieOptions(),
    maxAge: 0,
  })
  return response
}

const routeRoot = async () => {
  const adminStatus = await getAdminAuthStatus()
  const repositoryMode = await getGalleryRepositoryMode()

  return json({
    name: 'Event Gallery MVP API',
    repositoryMode,
    configuredDataAccessDriver: getDataAccessDriver(),
    configuredAdminAuthDriver: getAdminAuthDriver(),
    storageMode: getStorageMode(),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    adminConfigured: adminStatus.configured,
    adminSource: adminStatus.source,
  })
}

const createEvent = async (request) => {
  // Safe JSON parsing
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  // Manual validation before Zod to ensure clean error messages
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length < 3) {
    return json({ error: 'Event name must be at least 3 characters' }, 400)
  }

  // Now safe to use Zod for full validation
  let payload
  try {
    payload = createEventSchema.parse({ name })
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

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

const getAppUrl = (request) => {
  const envUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (envUrl) return envUrl.replace(/\/$/, '')

  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host = request.headers.get('host') || 'localhost'
  return `${proto}://${host}`
}

const saveEventByEmail = async (request, slug) => {
  if (!resend) {
    return json({ error: 'Email service is not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    return json({ error: 'Email sender is not configured' }, 503)
  }

  const appUrl = getAppUrl(request)
  const eventUrl = `${appUrl}/event/${event.slug}`

  try {
    const { data, error: sendError } = await resend.emails.send({
      from,
      to: email,
      reply_to: 'hello@snaprooms.app',
      subject: `Your SnapRooms room is ready`,
      text: `Hi,

Your SnapRooms room "${event.name}" is ready.

Open your room here:
${eventUrl}

Share this link with your guests so they can upload their photos.

If you didn't request this email, you can ignore it.

– SnapRooms
Every guest photo. One room.`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Your room is ready</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is ready.<br />
    Share the link below with your guests so they can upload their photos.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${eventUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open your room</a>
  </p>
  <div style="margin:0 0 24px;padding:16px;background:#F7F7F8;border:1px solid #E5E7EB;border-radius:8px;text-align:center;">
    <p style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#9ca3af;">Room link</p>
    <p style="margin:0;font-size:14px;word-break:break-all;color:#374151;">${eventUrl}</p>
  </div>
  <p style="margin:0 0 32px;text-align:center;color:#6b7280;font-size:14px;">
    If you didn't request this email, you can ignore it.
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
    })

    if (sendError) {
      console.error('[saveEventByEmail] Resend error:', sendError)
      return json({ error: sendError.message || 'Unable to send email' }, 502)
    }

    return json({ success: true, id: data?.id })
  } catch (error) {
    console.error('[saveEventByEmail] Unexpected error:', error)
    return json({ error: error?.message || 'Unable to send email' }, 502)
  }
}

const getManagementTokenFromRequest = (request) => {
  const auth = request.headers.get('authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

const saveEventOwner = async (request, slug) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = saveOwnerEmailSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const owner = await repository.getOrCreateOwnerByEmail(payload.email)
  const managementToken = generateManagementToken()
  const managementTokenHash = hashManagementToken(managementToken)

  const updatedEvent = await repository.setEventOwnerEmail(slug, {
    ownerEmail: payload.email,
    ownerId: owner?.id || null,
    managementTokenHash,
  })

  if (resend) {
    const from = process.env.RESEND_FROM_EMAIL
    if (from) {
      const appUrl = getAppUrl(request)
      try {
        const isFirstTime = !owner?.passwordHash
        if (isFirstTime) {
          const setupToken = await createSetupToken(payload.email)
          const setupUrl = `${appUrl}/dashboard/setup-password?token=${encodeURIComponent(setupToken)}`
          await resend.emails.send({
            from,
            to: payload.email,
            reply_to: 'hello@snaprooms.app',
            subject: `Set your SnapRooms password`,
            text: `Hi,

Your room "${event.name}" is ready.

To manage your rooms securely, set your password here:
${setupUrl}

This link expires in 7 days.

SnapRooms — Every guest photo. One room.`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Set your password</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is ready. Create a password to manage all your rooms in one place.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${setupUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Set password</a>
  </p>
  <p style="margin:0 0 32px;text-align:center;color:#6b7280;font-size:14px;">
    This link expires in 7 days. If you didn't create this room, you can safely ignore this email.
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
          })
        } else {
          const dashboardUrl = `${appUrl}/dashboard`
          await resend.emails.send({
            from,
            to: payload.email,
            reply_to: 'hello@snaprooms.app',
            subject: `Your SnapRooms room "${event.name}"`,
            text: `Hi,

Your room "${event.name}" has been added to your dashboard.

Open your dashboard:
${dashboardUrl}

SnapRooms — Every guest photo. One room.`,
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Room added to your dashboard</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    Your room <strong style="color:#111111;">${event.name}</strong> is now in your dashboard.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${dashboardUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Open dashboard</a>
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
          })
        }
      } catch (emailError) {
        console.error('[saveEventOwner] Failed to send owner email:', emailError)
      }
    }
  }

  return json({ event: updatedEvent, managementToken })
}

const updateEvent = async (request, slug) => {
  const token = getManagementTokenFromRequest(request)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = updateEventSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  if (!verifyManagementToken(token, event.managementTokenHash)) {
    return json({ error: 'Management token required' }, 403)
  }

  const updatedEvent = await repository.updateEvent(slug, payload)
  return json({ event: updatedEvent })
}

const deleteEvent = async (request, slug) => {
  const token = getManagementTokenFromRequest(request)

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(slug, { includeHidden: true })

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  if (!verifyManagementToken(token, event.managementTokenHash)) {
    return json({ error: 'Management token required' }, 403)
  }

  for (const photo of event.photos || []) {
    await deleteStoredFile(photo.url)
  }

  await repository.deleteEvent(slug)
  return json({ deleted: true })
}

const initUpload = async (request) => {
  const payload = uploadInitSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlug(payload.eventSlug)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const storageDriver = getStorageDriver()
  const session = await storageDriver.initUploadSession(payload)
  return json({ session }, 201)
}

const issueBlobUploadToken = async (request) => {
  // Explicit check for BLOB_READ_WRITE_TOKEN with clear error message
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[issueBlobUploadToken] BLOB_READ_WRITE_TOKEN is not defined')
    return json(
      { error: 'Server misconfiguration: BLOB_READ_WRITE_TOKEN is missing' },
      500
    )
  }

  if (!isVercelBlobStorageConfigured()) {
    console.error('[issueBlobUploadToken] Vercel Blob not configured')
    return json({ error: 'Vercel Blob is not configured' }, 500)
  }

  // Parse request body as required by @vercel/blob/client handleUpload
  let body
  try {
    body = await request.json()
  } catch (parseError) {
    console.error('[issueBlobUploadToken] Failed to parse request body:', parseError)
    return json({ error: 'Invalid request body' }, 400)
  }

  // Call handleUpload with parsed body and request
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = blobUploadClientPayloadSchema.parse(JSON.parse(clientPayload || '{}'))
        const repository = await getGalleryRepository()
        const event = await repository.getEventBySlug(payload.eventSlug)

        if (!event) {
          throw new Error('Event not found')
        }

        return {
          pathname: buildBlobPathname({ eventSlug: event.slug, fileName: payload.fileName }),
          allowedContentTypes: ['image/*'],
          maximumSizeInBytes: MAX_FILE_SIZE_BYTES,
          addRandomSuffix: true,
        }
      },
    })
    
    // Ensure we always return a valid Response
    if (!result) {
      console.error('[issueBlobUploadToken] handleUpload returned no result')
      return json({ error: 'Failed to generate upload token' }, 500)
    }
    
    return Response.json(result)
  } catch (error) {
    console.error('[issueBlobUploadToken] Error:', error?.message || error)
    return json(
      { error: error?.message || 'Unable to initialize Vercel Blob upload' },
      400
    )
  }
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
  const body = await request.json()
  const repository = await getGalleryRepository()

  if (body?.blobUrl) {
    const payload = blobUploadCompleteSchema.parse(body)
    const event = await repository.getEventBySlug(payload.eventSlug)

    if (!event) {
      return json({ error: 'Event not found while finalizing upload' }, 404)
    }

    const photo = await repository.createPhoto({
      eventId: event.id,
      originalName: payload.originalName,
      storedName: getStoredNameFromBlobPathname(payload.blobPathname),
      mimeType: payload.mimeType,
      size: payload.size,
      url: payload.blobUrl,
      uploaderName: payload.uploaderName,
      caption: payload.caption,
    })

    const freshEvent = await repository.getEventBySlug(event.slug)

    return json({
      photo,
      event: freshEvent,
    }, 201)
  }

  const payload = localUploadCompleteSchema.parse(body)
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

  await deleteStoredFile(photo.url)
  return json({ deleted: true, photo })
}

const getOwnerSession = async (request) => {
  const email = await getOwnerAuthentication(request)
  return json({ authenticated: Boolean(email), email })
}

const loginOwner = async (request) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email) {
    return json({ error: 'Email is required' }, 400)
  }

  const repository = await getGalleryRepository()

  // Password-based login takes priority
  if (password) {
    const owner = await repository.getOwnerByEmail(email)
    if (!owner || !owner.passwordHash || !owner.passwordSalt) {
      return json({ error: 'Invalid email or password' }, 401)
    }
    if (!verifyPassword(password, owner.passwordSalt, owner.passwordHash)) {
      return json({ error: 'Invalid email or password' }, 401)
    }
    const response = json({ authenticated: true, email })
    return await setOwnerSessionCookie(response, email)
  }

  // Fallback to management token login (backward compatibility)
  if (!token) {
    return json({ error: 'Password or management token is required' }, 400)
  }

  const events = await repository.listEventsByOwnerEmail(email)

  let valid = false
  for (const event of events) {
    const fullEvent = await repository.getEventBySlug(event.slug)
    if (fullEvent && verifyManagementToken(token, fullEvent.managementTokenHash)) {
      valid = true
      break
    }
  }

  if (!valid) {
    return json({ error: 'Invalid email or management token' }, 401)
  }

  const response = json({ authenticated: true, email })
  return await setOwnerSessionCookie(response, email)
}

const logoutOwner = () => {
  return clearOwnerSessionCookie(json({ authenticated: false, loggedOut: true }))
}

const resendOwnerAccess = async (request) => {
  if (!resend) {
    return json({ error: 'Email service is not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    return json({ error: 'Email sender is not configured' }, 503)
  }

  const repository = await getGalleryRepository()
  const owner = await repository.getOwnerByEmail(email)

  // Always return generic success — do not reveal whether email exists
  if (owner) {
    const appUrl = getAppUrl(request)
    if (owner.passwordHash) {
      const recoveryToken = await createRecoveryToken(email)
      const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(recoveryToken)}`

      try {
        await resend.emails.send({
          from,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject: `Reset your SnapRooms password`,
          text: `Hi,

You requested to reset your SnapRooms password.

Reset your password here:
${resetUrl}

This link expires in 30 minutes. If you didn't request it, you can safely ignore this email.

– SnapRooms
Every guest photo. One room.`,
          html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your SnapRooms password</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" max-width="480" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 16px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px;text-align:center;">
              <h1 style="margin:0;font-size:20px;font-weight:700;color:#111111;line-height:1.3;">Reset your password</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px;text-align:center;">
              <p style="margin:0;font-size:15px;color:#4b5563;line-height:1.6;">
                Tap the button below to reset your password. This link is valid for 30 minutes.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;text-align:center;">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">Reset password</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;word-break:break-all;">
                Or copy this link:<br>
                <a href="${resetUrl}" style="color:#FF6B4A;text-decoration:underline;">${resetUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                SnapRooms — Every guest photo. One room.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
        })
      } catch (emailError) {
        console.error('[resendOwnerAccess] Failed to send reset email:', emailError)
      }
    } else {
      // Owner exists but has no password yet — send setup link
      const setupToken = await createSetupToken(email)
      const setupUrl = `${appUrl}/dashboard/setup-password?token=${encodeURIComponent(setupToken)}`

      try {
        await resend.emails.send({
          from,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject: `Set your SnapRooms password`,
          text: `Hi,

You requested access to your SnapRooms dashboard.

Set your password here:
${setupUrl}

This link expires in 7 days.

– SnapRooms
Every guest photo. One room.`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span>
  </div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Set your password</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">
    You requested access to your SnapRooms dashboard. Create a password to manage all your rooms in one place.
  </p>
  <p style="margin:0 0 24px;text-align:center;">
    <a href="${setupUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Set password</a>
  </p>
  <p style="margin:0 0 32px;text-align:center;color:#6b7280;font-size:14px;">
    This link expires in 7 days. If you didn't request this, you can safely ignore this email.
  </p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
    SnapRooms — Every guest photo. One room.
  </p>
</div>`,
        })
      } catch (emailError) {
        console.error('[resendOwnerAccess] Failed to send setup email:', emailError)
      }
    }
  }

  return json({ success: true })
}

const recoverOwnerAccess = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return json({ error: 'Recovery token required' }, 400)
  }

  const email = await verifyRecoveryToken(token)

  if (!email) {
    return json({ error: 'Invalid or expired recovery link' }, 400)
  }

  const appUrl = getAppUrl(request)
  const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(token)}`
  return NextResponse.redirect(new URL(resetUrl, request.url))
}

const loginOwnerWithPassword = async (request) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) {
    return json({ error: 'Email and password are required' }, 400)
  }

  const repository = await getGalleryRepository()
  const owner = await repository.getOwnerByEmail(email)

  if (!owner || !owner.passwordHash || !owner.passwordSalt) {
    return json({ error: 'Invalid email or password' }, 401)
  }

  if (!verifyPassword(password, owner.passwordSalt, owner.passwordHash)) {
    return json({ error: 'Invalid email or password' }, 401)
  }

  const response = json({ authenticated: true, email })
  return await setOwnerSessionCookie(response, email)
}

const forgotOwnerPassword = async (request) => {
  if (!resend) {
    return json({ error: 'Email service is not configured' }, 503)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }

  const from = process.env.RESEND_FROM_EMAIL
  if (!from) {
    return json({ error: 'Email sender is not configured' }, 503)
  }

  const repository = await getGalleryRepository()
  const owner = await repository.getOwnerByEmail(email)

  if (owner) {
    const appUrl = getAppUrl(request)
    if (owner.passwordHash) {
      const recoveryToken = await createRecoveryToken(email)
      const resetUrl = `${appUrl}/dashboard/reset-password?token=${encodeURIComponent(recoveryToken)}`

      try {
        await resend.emails.send({
          from,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject: `Reset your SnapRooms password`,
          text: `Hi,

You requested to reset your SnapRooms password.

Reset your password here:
${resetUrl}

This link expires in 30 minutes.

– SnapRooms`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;"><span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span></div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Reset your password</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">Tap the button below to reset your password. This link is valid for 30 minutes.</p>
  <p style="margin:0 0 24px;text-align:center;"><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Reset password</a></p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">SnapRooms — Every guest photo. One room.</p>
</div>`,
        })
      } catch (emailError) {
        console.error('[forgotOwnerPassword] Failed to send reset email:', emailError)
      }
    } else {
      // Owner exists but has no password yet — send setup link
      const setupToken = await createSetupToken(email)
      const setupUrl = `${appUrl}/dashboard/setup-password?token=${encodeURIComponent(setupToken)}`

      try {
        await resend.emails.send({
          from,
          to: email,
          reply_to: 'hello@snaprooms.app',
          subject: `Set your SnapRooms password`,
          text: `Hi,

You requested access to your SnapRooms dashboard.

Set your password here:
${setupUrl}

This link expires in 7 days.

– SnapRooms`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;color:#111111;">
  <div style="text-align:center;margin-bottom:24px;"><span style="font-size:20px;font-weight:700;color:#FF6B4A;letter-spacing:-0.5px;">SnapRooms</span></div>
  <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;text-align:center;">Set your password</h1>
  <p style="margin:0 0 24px;text-align:center;color:#4b5563;">You requested access to your SnapRooms dashboard. Create a password to manage all your rooms in one place.</p>
  <p style="margin:0 0 24px;text-align:center;"><a href="${setupUrl}" style="display:inline-block;padding:12px 24px;background:#FF6B4A;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Set password</a></p>
  <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">SnapRooms — Every guest photo. One room.</p>
</div>`,
        })
      } catch (emailError) {
        console.error('[forgotOwnerPassword] Failed to send setup email:', emailError)
      }
    }
  }

  return json({ success: true })
}

const resetOwnerPassword = async (request) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!token || !password) {
    return json({ error: 'Token and password are required' }, 400)
  }

  const { valid, errors } = validatePassword(password)
  if (!valid) {
    return json({ error: `Password requirements: ${errors.join(', ')}` }, 400)
  }

  const email = await verifyRecoveryToken(token)
  if (!email) {
    return json({ error: 'Invalid or expired reset token' }, 400)
  }

  const repository = await getGalleryRepository()
  const owner = await repository.getOwnerByEmail(email)
  if (!owner) {
    return json({ error: 'Invalid or expired reset token' }, 400)
  }

  const { salt, hash } = createPasswordHash(password)
  await repository.setOwnerPassword(owner.id, { passwordHash: hash, passwordSalt: salt })

  const response = json({ authenticated: true, email })
  return await setOwnerSessionCookie(response, email)
}

const getSetupTokenStatus = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return json({ error: 'Setup token required' }, 400)
  }

  const email = await verifySetupToken(token)
  if (!email) {
    return json({ error: 'Invalid or expired setup link' }, 400)
  }

  return json({ valid: true, email })
}

const getResetTokenStatus = async (request) => {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return json({ error: 'Reset token required' }, 400)
  }

  const email = await verifyRecoveryToken(token)
  if (!email) {
    return json({ error: 'Invalid or expired reset link' }, 400)
  }

  return json({ valid: true, email })
}

const setupOwnerPassword = async (request) => {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!token || !password) {
    return json({ error: 'Token and password are required' }, 400)
  }

  const { valid, errors } = validatePassword(password)
  if (!valid) {
    return json({ error: `Password requirements: ${errors.join(', ')}` }, 400)
  }

  const email = await verifySetupToken(token)
  if (!email) {
    return json({ error: 'Invalid or expired setup token' }, 400)
  }

  const repository = await getGalleryRepository()
  let owner = await repository.getOwnerByEmail(email)
  if (!owner) {
    owner = await repository.getOrCreateOwnerByEmail(email)
  }

  if (owner.passwordHash) {
    return json({ error: 'Password already set. Sign in or use forgot password.' }, 400)
  }

  const { salt, hash } = createPasswordHash(password)
  await repository.setOwnerPassword(owner.id, { passwordHash: hash, passwordSalt: salt })

  const response = json({ authenticated: true, email })
  return await setOwnerSessionCookie(response, email)
}

const listOwnerEvents = async (request) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const events = await repository.listEventsByOwnerEmail(ownerEmail)
  return json({ events: events.map(({ managementTokenHash, ...event }) => event) })
}

const getOwnerEvent = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const { managementTokenHash, ...safeEvent } = event
  return json({ event: safeEvent })
}

const updateOwnerEvent = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  let payload
  try {
    payload = updateEventSchema.parse(body)
  } catch (zodError) {
    return json({ error: formatZodError(zodError) }, 400)
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const updatedEvent = await repository.updateEvent(slug, payload)
  return json({ event: updatedEvent })
}

const deleteOwnerEvent = async (request, slug) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const event = await repository.getEventBySlugAndOwner(slug, ownerEmail)

  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  for (const photo of event.photos || []) {
    await deleteStoredFile(photo.url)
  }

  await repository.deleteEvent(slug)
  return json({ deleted: true })
}

const moderateOwnerPhoto = async (request, photoId) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const payload = adminModerationSchema.parse(await request.json())
  const repository = await getGalleryRepository()
  const photo = await repository.setPhotoStatusByOwner(photoId, payload.action === 'approve' ? 'VISIBLE' : 'HIDDEN', ownerEmail)

  if (!photo) {
    return json({ error: 'Photo not found' }, 404)
  }

  return json({ photo })
}

const deleteOwnerPhoto = async (request, photoId) => {
  const ownerEmail = await requireOwner(request)
  if (typeof ownerEmail !== 'string') {
    return ownerEmail
  }

  const repository = await getGalleryRepository()
  const photo = await repository.deletePhotoByOwner(photoId, ownerEmail)

  if (!photo) {
    return json({ error: 'Photo not found' }, 404)
  }

  await deleteStoredFile(photo.url)
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

    if (segments[0] === 'owner') {
      if (segments.length === 2 && segments[1] === 'session' && method === 'GET') {
        return getOwnerSession(request)
      }

      if (segments.length === 2 && segments[1] === 'session' && method === 'POST') {
        return loginOwner(request)
      }

      if (segments.length === 2 && segments[1] === 'login' && method === 'POST') {
        return loginOwnerWithPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'logout' && method === 'POST') {
        return logoutOwner()
      }

      if (segments.length === 2 && segments[1] === 'resend' && method === 'POST') {
        return resendOwnerAccess(request)
      }

      if (segments.length === 2 && segments[1] === 'recover' && method === 'GET') {
        return recoverOwnerAccess(request)
      }

      if (segments.length === 2 && segments[1] === 'forgot-password' && method === 'POST') {
        return forgotOwnerPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'reset-password' && method === 'GET') {
        return getResetTokenStatus(request)
      }

      if (segments.length === 2 && segments[1] === 'reset-password' && method === 'POST') {
        return resetOwnerPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'GET') {
        return getSetupTokenStatus(request)
      }

      if (segments.length === 2 && segments[1] === 'setup' && method === 'POST') {
        return setupOwnerPassword(request)
      }

      if (segments.length === 2 && segments[1] === 'events' && method === 'GET') {
        return listOwnerEvents(request)
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'GET') {
        return getOwnerEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'PATCH') {
        return updateOwnerEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'events' && method === 'DELETE') {
        return deleteOwnerEvent(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'PATCH') {
        return moderateOwnerPhoto(request, segments[2])
      }

      if (segments.length === 3 && segments[1] === 'photos' && method === 'DELETE') {
        return deleteOwnerPhoto(request, segments[2])
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

      if (segments.length === 3 && segments[2] === 'email' && method === 'POST') {
        return saveEventByEmail(request, segments[1])
      }

      if (segments.length === 3 && segments[2] === 'owner' && method === 'POST') {
        return saveEventOwner(request, segments[1])
      }

      if (segments.length === 2 && method === 'PATCH') {
        return updateEvent(request, segments[1])
      }

      if (segments.length === 2 && method === 'DELETE') {
        return deleteEvent(request, segments[1])
      }
    }

    if (segments[0] === 'uploads') {
      if (segments.length === 2 && segments[1] === 'init' && method === 'POST') {
        return initUpload(request)
      }

      if (segments.length === 2 && segments[1] === 'blob' && method === 'POST') {
        return issueBlobUploadToken(request)
      }

      if (segments.length === 2 && segments[1] === 'chunk' && method === 'POST') {
        return uploadChunk(request)
      }

      if (segments.length === 2 && segments[1] === 'complete' && method === 'POST') {
        return completeUpload(request)
      }
    }

    return json({ error: `Route /${segments.join('/')} not found` }, 404)
  } catch (error) {
    console.error('[API Route] Error:', error?.message || error)

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
