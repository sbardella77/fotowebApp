import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { slugify } from './schemas'

const DATA_DIRECTORY = path.join(process.cwd(), 'data')
const DATABASE_FILE = path.join(DATA_DIRECTORY, 'mock-db.json')

const defaultDatabase = {
  events: [],
  photos: [],
}

const ensureDatabaseFile = async () => {
  await mkdir(DATA_DIRECTORY, { recursive: true })

  try {
    await readFile(DATABASE_FILE, 'utf8')
  } catch {
    await writeFile(DATABASE_FILE, JSON.stringify(defaultDatabase, null, 2), 'utf8')
  }
}

const readDatabase = async () => {
  await ensureDatabaseFile()
  const content = await readFile(DATABASE_FILE, 'utf8')
  return JSON.parse(content)
}

const writeDatabase = async (payload) => {
  await ensureDatabaseFile()
  await writeFile(DATABASE_FILE, JSON.stringify(payload, null, 2), 'utf8')
}

const buildUniqueSlug = (requestedSlug, events) => {
  const baseSlug = slugify(requestedSlug) || `event-${randomUUID().slice(0, 6)}`
  let candidate = baseSlug
  let suffix = 2

  while (events.some((event) => event.slug === candidate)) {
    candidate = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return candidate
}

const enrichEvent = (event, photos = []) => ({
  ...event,
  photoCount: photos.length,
  latestPhotoUrl: photos[0]?.url || null,
})

export const mockGalleryRepository = {
  async createEvent({ name }) {
    const database = await readDatabase()
    const slug = buildUniqueSlug(name, database.events)

    const event = {
      id: randomUUID(),
      slug,
      name,
      coverPhotoId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    database.events.unshift(event)
    await writeDatabase(database)
    return enrichEvent(event)
  },

  async listEvents() {
    const database = await readDatabase()

    return database.events
      .map((event) => {
        const photos = database.photos
          .filter((photo) => photo.eventId === event.id && photo.status === 'VISIBLE')
          .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))

        return enrichEvent(event, photos)
      })
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
      .slice(0, 10)
  },

  async getEventBySlug(slug) {
    const database = await readDatabase()
    const event = database.events.find((item) => item.slug === slug)

    if (!event) {
      return null
    }

    const photos = database.photos
      .filter((photo) => photo.eventId === event.id && photo.status === 'VISIBLE')
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))

    return {
      ...enrichEvent(event, photos),
      photos,
    }
  },

  async createPhoto({ eventId, originalName, storedName, mimeType, size, url, uploaderName, caption }) {
    const database = await readDatabase()
    const event = database.events.find((item) => item.id === eventId)

    if (!event) {
      throw new Error('Event not found while saving photo metadata')
    }

    const photo = {
      id: randomUUID(),
      eventId,
      originalName,
      storedName,
      mimeType,
      size,
      url,
      uploaderName: uploaderName || null,
      caption: caption || null,
      status: 'VISIBLE',
      uploadSource: 'mobile',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    database.photos.unshift(photo)
    event.updatedAt = new Date().toISOString()
    event.coverPhotoId = event.coverPhotoId || photo.id

    await writeDatabase(database)
    return photo
  },
}
