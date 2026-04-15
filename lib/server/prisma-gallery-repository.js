import { slugify } from './schemas'
import { getPrismaClient } from './prisma-client'
import { normalizeEventRecord, normalizePhotoRecord } from './repository-mappers'

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

const getLatestVisiblePhoto = async (prisma, eventId) => {
  return prisma.photo.findFirst({
    where: {
      eventId,
      status: 'VISIBLE',
    },
    orderBy: { createdAt: 'desc' },
  })
}

const syncEventCoverPhoto = async (prisma, eventId) => {
  const newestVisiblePhoto = await getLatestVisiblePhoto(prisma, eventId)

  await prisma.event.update({
    where: { id: eventId },
    data: {
      coverPhotoId: newestVisiblePhoto?.id || null,
      updatedAt: new Date(),
    },
  })
}

export const prismaGalleryRepository = {
  async createEvent({ name }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.create({
      data: {
        name,
        slug: await buildUniqueSlug(prisma, name),
      },
    })

    return normalizeEventRecord({
      event,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async listEvents() {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
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
      events.map(async (event) => {
        const photoCount = await prisma.photo.count({
          where: {
            eventId: event.id,
            status: 'VISIBLE',
          },
        })

        return normalizeEventRecord({
          event,
          photos: [],
          photoCount,
          latestPhotoUrl: event.photos[0]?.url || null,
        })
      }),
    )
  },

  async setEventOwnerEmail(slug, { ownerEmail, managementTokenHash }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) {
      return null
    }

    const updatedEvent = await prisma.event.update({
      where: { slug },
      data: {
        ownerEmail: ownerEmail || null,
        managementTokenHash: managementTokenHash || null,
        updatedAt: new Date(),
      },
    })

    return normalizeEventRecord({
      event: updatedEvent,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async updateEvent(slug, { name }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) {
      return null
    }

    const updatedEvent = await prisma.event.update({
      where: { slug },
      data: {
        name: name ?? event.name,
        updatedAt: new Date(),
      },
    })

    return normalizeEventRecord({
      event: updatedEvent,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async deleteEvent(slug) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) {
      return null
    }

    await prisma.event.delete({ where: { slug } })

    return normalizeEventRecord({
      event,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async getEventBySlug(slug, options = {}) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({
      where: { slug },
      include: {
        photos: {
          where: options.includeHidden ? undefined : { status: 'VISIBLE' },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!event) {
      return null
    }

    const latestVisiblePhoto = await getLatestVisiblePhoto(prisma, event.id)
    const visiblePhotoCount = await prisma.photo.count({
      where: {
        eventId: event.id,
        status: 'VISIBLE',
      },
    })

    return normalizeEventRecord({
      event,
      photos: event.photos,
      photoCount: options.includeHidden ? event.photos.length : visiblePhotoCount,
      latestPhotoUrl: latestVisiblePhoto?.url || null,
    })
  },

  async listEventsByOwnerEmail(ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const events = await prisma.event.findMany({
      where: { ownerEmail: ownerEmail.toLowerCase().trim() },
      take: 50,
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
      events.map(async (event) => {
        const photoCount = await prisma.photo.count({
          where: {
            eventId: event.id,
            status: 'VISIBLE',
          },
        })

        return normalizeEventRecord({
          event,
          photos: [],
          photoCount,
          latestPhotoUrl: event.photos[0]?.url || null,
        })
      }),
    )
  },

  async getEventBySlugAndOwner(slug, ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findFirst({
      where: {
        slug,
        ownerEmail: ownerEmail.toLowerCase().trim(),
      },
      include: {
        photos: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!event) {
      return null
    }

    const latestVisiblePhoto = await getLatestVisiblePhoto(prisma, event.id)
    const visiblePhotoCount = await prisma.photo.count({
      where: {
        eventId: event.id,
        status: 'VISIBLE',
      },
    })

    return normalizeEventRecord({
      event,
      photos: event.photos,
      photoCount: visiblePhotoCount,
      latestPhotoUrl: latestVisiblePhoto?.url || null,
    })
  },

  async setPhotoStatusByOwner(photoId, status, ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    const event = await prisma.event.findUnique({ where: { id: photo.eventId } })

    if (!event || event.ownerEmail?.toLowerCase() !== ownerEmail.toLowerCase().trim()) {
      return null
    }

    const updatedPhoto = await prisma.photo.update({
      where: { id: photoId },
      data: {
        status,
        updatedAt: new Date(),
      },
    })

    await syncEventCoverPhoto(prisma, updatedPhoto.eventId)
    return normalizePhotoRecord(updatedPhoto)
  },

  async deletePhotoByOwner(photoId, ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    const event = await prisma.event.findUnique({ where: { id: photo.eventId } })

    if (!event || event.ownerEmail?.toLowerCase() !== ownerEmail.toLowerCase().trim()) {
      return null
    }

    await prisma.photo.delete({ where: { id: photoId } })
    await syncEventCoverPhoto(prisma, photo.eventId)

    return normalizePhotoRecord(photo)
  },

  async createPhoto({ eventId, originalName, storedName, mimeType, size, url, uploaderName, caption }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
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

    await syncEventCoverPhoto(prisma, eventId)
    return normalizePhotoRecord(photo)
  },

  async setPhotoStatus(photoId, status) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
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

    await syncEventCoverPhoto(prisma, updatedPhoto.eventId)
    return normalizePhotoRecord(updatedPhoto)
  },

  async deletePhoto(photoId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    await prisma.photo.delete({ where: { id: photoId } })
    await syncEventCoverPhoto(prisma, photo.eventId)

    return normalizePhotoRecord(photo)
  },
}
