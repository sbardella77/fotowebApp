const fs = require('fs')
const path = require('path')

const ENV_FILE_PATH = path.join(process.cwd(), '.env')

const loadEnvFile = () => {
  if (!fs.existsSync(ENV_FILE_PATH)) {
    return
  }

  const lines = fs.readFileSync(ENV_FILE_PATH, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvFile()


const MOCK_DB_PATH = path.join(process.cwd(), 'data', 'mock-db.json')
const LOCAL_ADMIN_AUTH_PATH = path.join(process.cwd(), 'data', 'admin-auth.json')
const PRIMARY_ADMIN_KEY = 'primary'

const hasFlag = (flag) => process.argv.includes(flag)
const isExecuteMode = hasFlag('--execute')
const includeAdminAuth = hasFlag('--include-admin-auth')

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const toDate = (value, fallback = new Date()) => {
  if (!value) {
    return fallback
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

const sortNewestFirst = (items = []) => {
  return [...items].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
}

const summarizeSourceData = ({ events, photos, adminAuth }) => {
  const statusCounts = photos.reduce((accumulator, photo) => {
    const key = photo.status || 'UNKNOWN'
    accumulator[key] = (accumulator[key] || 0) + 1
    return accumulator
  }, {})

  return {
    eventCount: events.length,
    photoCount: photos.length,
    adminCredentialPresent: Boolean(adminAuth),
    photoStatusCounts: statusCounts,
  }
}

const ensureUnique = (items, key, label) => {
  const seen = new Set()

  for (const item of items) {
    const value = item[key]

    if (!value) {
      throw new Error(`${label} is missing required field: ${key}`)
    }

    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} ${key} detected in source data: ${value}`)
    }

    seen.add(value)
  }
}

const sanitizeEvents = (events = []) => {
  return events.map((event) => ({
    id: String(event.id),
    slug: String(event.slug),
    name: String(event.name),
    coverPhotoId: event.coverPhotoId || null,
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt, toDate(event.createdAt)),
  }))
}

const sanitizePhotos = (photos = []) => {
  return photos.map((photo) => ({
    id: String(photo.id),
    eventId: String(photo.eventId),
    originalName: String(photo.originalName),
    storedName: String(photo.storedName),
    mimeType: String(photo.mimeType),
    size: Number(photo.size || 0),
    url: String(photo.url),
    uploaderName: photo.uploaderName || null,
    caption: photo.caption || null,
    status: photo.status === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE',
    uploadSource: photo.uploadSource || 'mobile',
    createdAt: toDate(photo.createdAt),
    updatedAt: toDate(photo.updatedAt, toDate(photo.createdAt)),
  }))
}

const getLatestVisiblePhotoId = (photos, eventId) => {
  return sortNewestFirst(photos.filter((photo) => photo.eventId === eventId && photo.status === 'VISIBLE'))[0]?.id || null
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to use this migration script.')
  }

  const source = readJsonFile(MOCK_DB_PATH)

  if (!source) {
    throw new Error(`Source file not found: ${MOCK_DB_PATH}`)
  }

  const adminAuth = readJsonFile(LOCAL_ADMIN_AUTH_PATH)
  const events = sanitizeEvents(Array.isArray(source.events) ? source.events : [])
  const photos = sanitizePhotos(Array.isArray(source.photos) ? source.photos : [])

  ensureUnique(events, 'id', 'event')
  ensureUnique(events, 'slug', 'event')
  ensureUnique(photos, 'id', 'photo')

  const eventIds = new Set(events.map((event) => event.id))
  const validPhotos = photos.filter((photo) => eventIds.has(photo.eventId))
  const orphanPhotos = photos.filter((photo) => !eventIds.has(photo.eventId))

  const sourceSummary = summarizeSourceData({ events, photos: validPhotos, adminAuth })

  console.log('=== Local JSON → Prisma Migration Summary ===')
  console.log(JSON.stringify({
    mode: isExecuteMode ? 'execute' : 'dry-run',
    includeAdminAuth,
    sourceSummary,
    orphanPhotoCount: orphanPhotos.length,
    orphanPhotoIds: orphanPhotos.map((photo) => photo.id),
  }, null, 2))

  if (!isExecuteMode) {
    console.log('\nDry-run only. No database writes were attempted.')
    console.log('To execute later: yarn migrate:local-to-prisma')
    console.log('Admin auth is intentionally excluded by default. Keep ADMIN_AUTH_DRIVER=local for the first DB switch.')
    return
  }

  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()

  try {
    await prisma.$transaction(async (transaction) => {
      for (const event of events) {
        await transaction.event.upsert({
          where: { id: event.id },
          update: {
            slug: event.slug,
            name: event.name,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            coverPhotoId: null,
          },
          create: {
            id: event.id,
            slug: event.slug,
            name: event.name,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            coverPhotoId: null,
          },
        })
      }

      for (const photo of validPhotos) {
        await transaction.photo.upsert({
          where: { id: photo.id },
          update: {
            eventId: photo.eventId,
            originalName: photo.originalName,
            storedName: photo.storedName,
            mimeType: photo.mimeType,
            size: photo.size,
            url: photo.url,
            uploaderName: photo.uploaderName,
            caption: photo.caption,
            status: photo.status,
            uploadSource: photo.uploadSource,
            createdAt: photo.createdAt,
            updatedAt: photo.updatedAt,
          },
          create: {
            id: photo.id,
            eventId: photo.eventId,
            originalName: photo.originalName,
            storedName: photo.storedName,
            mimeType: photo.mimeType,
            size: photo.size,
            url: photo.url,
            uploaderName: photo.uploaderName,
            caption: photo.caption,
            status: photo.status,
            uploadSource: photo.uploadSource,
            createdAt: photo.createdAt,
            updatedAt: photo.updatedAt,
          },
        })
      }

      for (const event of events) {
        await transaction.event.update({
          where: { id: event.id },
          data: {
            coverPhotoId: getLatestVisiblePhotoId(validPhotos, event.id),
            updatedAt: event.updatedAt,
          },
        })
      }

      if (includeAdminAuth && adminAuth?.salt && adminAuth?.hash) {
        await transaction.adminCredential.upsert({
          where: { key: PRIMARY_ADMIN_KEY },
          update: {
            passwordSalt: String(adminAuth.salt),
            passwordHash: String(adminAuth.hash),
          },
          create: {
            key: PRIMARY_ADMIN_KEY,
            passwordSalt: String(adminAuth.salt),
            passwordHash: String(adminAuth.hash),
          },
        })
      }
    })

    console.log('\nMigration completed successfully.')
    console.log(`Imported/updated ${events.length} events and ${validPhotos.length} photos.`)

    if (includeAdminAuth) {
      console.log('AdminCredential was also upserted into Prisma.')
    } else {
      console.log('Admin auth was intentionally NOT migrated. Keep ADMIN_AUTH_DRIVER=local for first switch.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('\nMigration aborted.')
  console.error(error)
  process.exit(1)
})
