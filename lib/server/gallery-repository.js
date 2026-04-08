import { mockGalleryRepository } from './mock-db'
import { slugify } from './schemas'

let prismaClientInstance = globalThis.__eventGalleryPrismaClient || null

const getPrismaClient = async () => {
  if (!process.env.DATABASE_URL) {
    return null
  }

  try {
    const { PrismaClient } = await import('@prisma/client')

    if (!prismaClientInstance) {
      prismaClientInstance = new PrismaClient()
      globalThis.__eventGalleryPrismaClient = prismaClientInstance
    }

    return prismaClientInstance
  } catch (error) {
    console.warn('Prisma client unavailable, using local repository fallback.', error)
    return null
  }
}

const serializePhoto = (photo) => ({
  ...photo,
  createdAt: photo.createdAt.toISOString(),
  updatedAt: photo.updatedAt.toISOString(),
})

const ensureEventCover = async (prisma, eventId) => {
  const newestVisiblePhoto = await prisma.photo.findFirst({
    where: {
      eventId,
      status: 'VISIBLE',
    },
    orderBy: { createdAt: 'desc' },
  })

  await prisma.event.update({
    where: { id: eventId },
    data: {
      coverPhotoId: newestVisiblePhoto?.id || null,
      updatedAt: new Date(),
    },
  })
}

const buildUniqueSlug = async (prisma, name) => {
  const baseSlug = slugify(name) || `event-${Date.now()}`
  let candidate = baseSlug
  let suffix = 2

  while (await prisma.event.findUnique({ where: { slug: candidate } })) {
    candidate = `${baseSlug}-${suffix}`
    suffix += 1
  }

  return candidate
}

const prismaGalleryRepository = {
  async createEvent({ name }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.createEvent({ name })
    }

    const event = await prisma.event.create({
      data: {
        name,
        slug: await buildUniqueSlug(prisma, name),
      },
    })

    return {
      ...event,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      photoCount: 0,
      latestPhotoUrl: null,
    }
  },

  async listEvents() {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.listEvents()
    }

    const events = await prisma.event.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        photos: {
          where: { status: 'VISIBLE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    return Promise.all(
      events.map(async (event) => ({
        id: event.id,
        slug: event.slug,
        name: event.name,
        coverPhotoId: event.coverPhotoId,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        photoCount: await prisma.photo.count({
          where: {
            eventId: event.id,
            status: 'VISIBLE',
          },
        }),
        latestPhotoUrl: event.photos[0]?.url || null,
      })),
    )
  },

  async getEventBySlug(slug, options = {}) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.getEventBySlug(slug, options)
    }

    const photoWhere = options.includeHidden ? {} : { status: 'VISIBLE' }

    const event = await prisma.event.findUnique({
      where: { slug },
      include: {
        photos: {
          where: photoWhere,
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!event) {
      return null
    }

    const visiblePhotoCount = await prisma.photo.count({
      where: {
        eventId: event.id,
        status: 'VISIBLE',
      },
    })

    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      coverPhotoId: event.coverPhotoId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      photoCount: options.includeHidden ? event.photos.length : visiblePhotoCount,
      latestPhotoUrl: event.photos[0]?.url || null,
      photos: event.photos.map(serializePhoto),
    }
  },

  async createPhoto({ eventId, originalName, storedName, mimeType, size, url, uploaderName, caption }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.createPhoto({
        eventId,
        originalName,
        storedName,
        mimeType,
        size,
        url,
        uploaderName,
        caption,
      })
    }

    const photo = await prisma.photo.create({
      data: {
        eventId,
        originalName,
        storedName,
        mimeType,
        size,
        url,
        uploaderName: uploaderName || null,
        caption: caption || null,
        status: 'VISIBLE',
      },
    })

    await ensureEventCover(prisma, eventId)
    return serializePhoto(photo)
  },

  async setPhotoStatus(photoId, status) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.setPhotoStatus(photoId, status)
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    const updatedPhoto = await prisma.photo.update({
      where: { id: photoId },
      data: {
        status,
        updatedAt: new Date(),
      },
    })

    await ensureEventCover(prisma, updatedPhoto.eventId)
    return serializePhoto(updatedPhoto)
  },

  async deletePhoto(photoId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.deletePhoto(photoId)
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    await prisma.photo.delete({ where: { id: photoId } })
    await ensureEventCover(prisma, photo.eventId)

    return serializePhoto(photo)
  },
}

export const getGalleryRepository = async () => {
  return prismaGalleryRepository
}
