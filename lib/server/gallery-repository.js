import { mockGalleryRepository } from './mock-db'

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

const prismaGalleryRepository = {
  async createEvent({ name }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.createEvent({ name })
    }

    const baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || `event-${Date.now()}`

    let slug = baseSlug
    let suffix = 2

    while (await prisma.event.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }

    const event = await prisma.event.create({
      data: {
        name,
        slug,
      },
    })

    return {
      ...event,
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
        _count: {
          select: { photos: true },
        },
      },
    })

    return events.map((event) => ({
      id: event.id,
      slug: event.slug,
      name: event.name,
      coverPhotoId: event.coverPhotoId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      photoCount: event._count.photos,
      latestPhotoUrl: event.photos[0]?.url || null,
    }))
  },

  async getEventBySlug(slug) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return mockGalleryRepository.getEventBySlug(slug)
    }

    const event = await prisma.event.findUnique({
      where: { slug },
      include: {
        photos: {
          where: { status: 'VISIBLE' },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!event) {
      return null
    }

    return {
      id: event.id,
      slug: event.slug,
      name: event.name,
      coverPhotoId: event.coverPhotoId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
      photoCount: event.photos.length,
      latestPhotoUrl: event.photos[0]?.url || null,
      photos: event.photos.map((photo) => ({
        ...photo,
        createdAt: photo.createdAt.toISOString(),
        updatedAt: photo.updatedAt.toISOString(),
      })),
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

    await prisma.event.update({
      where: { id: eventId },
      data: {
        updatedAt: new Date(),
      },
    })

    return {
      ...photo,
      createdAt: photo.createdAt.toISOString(),
      updatedAt: photo.updatedAt.toISOString(),
    }
  },
}

export const getGalleryRepository = async () => {
  return prismaGalleryRepository
}
