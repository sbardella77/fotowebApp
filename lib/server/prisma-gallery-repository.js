import { slugify } from './schemas'
import { getPrismaClient } from './prisma-client'
import { normalizeEventRecord, normalizePhotoRecord, normalizePrivateAssetRecord, normalizeEventMomentRecord } from './repository-mappers'
import { resolveCanonicalOwner, getOrCreateCanonicalOwner } from './owner-resolution'

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
  async createEvent({ name, prismaClient = null }) {
    const prisma = prismaClient || (await getPrismaClient())

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
        _count: {
          select: { photos: { where: { status: 'VISIBLE' } } },
        },
      },
    })

    return events.map((event) => {
      const { _count, ...eventRecord } = event
      return normalizeEventRecord({
        event: eventRecord,
        photos: [],
        photoCount: _count.photos,
        latestPhotoUrl: event.photos[0]?.url || null,
      })
    })
  },

  async getOwnerByEmail(email) {
    return resolveCanonicalOwner(email)
  },

  async getOrCreateOwnerByEmail(email) {
    return getOrCreateCanonicalOwner(email)
  },

  async setOwnerPassword(ownerId, { passwordHash, passwordSalt }) {
    const prisma = await getPrismaClient()
    if (!prisma) return null
    return prisma.owner.update({
      where: { id: ownerId },
      data: { passwordHash, passwordSalt, updatedAt: new Date() },
    })
  },

  async setEventOwnerEmail(slug, { ownerEmail, ownerId, managementTokenHash }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) {
      return null
    }

    const data = {
      ownerEmail: ownerEmail || null,
      managementTokenHash: managementTokenHash || null,
      updatedAt: new Date(),
    }
    if (ownerId !== undefined) data.ownerId = ownerId || null

    const updatedEvent = await prisma.event.update({
      where: { slug },
      data,
    })

    return normalizeEventRecord({
      event: updatedEvent,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async updateEvent(slug, { name, coverUrl }) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { slug } })

    if (!event) {
      return null
    }

    const data = {
      name: name ?? event.name,
      updatedAt: new Date(),
    }
    if (coverUrl !== undefined) {
      data.coverUrl = coverUrl
    }

    const updatedEvent = await prisma.event.update({
      where: { slug },
      data,
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
    const start = Date.now()
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
          take: 100,
        },
        moments: {
          orderBy: { sortOrder: 'asc' },
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

    const result = normalizeEventRecord({
      event,
      photos: event.photos,
      photoCount: options.includeHidden ? event.photos.length : visiblePhotoCount,
      latestPhotoUrl: event.photos[0]?.url || null,
      moments: event.moments,
    })

    console.log(`[repo:getEventBySlug:${slug}] total=${Date.now() - start}ms photosLoaded=${event.photos.length} photoCount=${result.photoCount}`)
    return result
  },

  async getEventPhotosPaginated({ eventId, cursor, take = 24, sort = 'recent', momentSlug = null }) {
    const start = Date.now()
    const prisma = await getPrismaClient()
    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const orderBy = sort === 'oldest'
      ? { createdAt: 'asc' }
      : { createdAt: 'desc' }

    const where = { eventId, status: 'VISIBLE' }

    if (momentSlug === 'unassigned') {
      where.momentId = null
    } else if (momentSlug) {
      const moment = await prisma.eventMoment.findUnique({
        where: { eventId_slug: { eventId, slug: momentSlug } },
      })
      if (moment) {
        where.momentId = moment.id
      } else {
        // Moment not found: return empty
        return { photos: [], nextCursor: null, total: 0 }
      }
    }

    const photos = await prisma.photo.findMany({
      where,
      orderBy,
      take: take + 1,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      select: {
        id: true,
        originalName: true,
        storedName: true,
        mimeType: true,
        url: true,
        uploaderName: true,
        caption: true,
        createdAt: true,
        momentId: true,
      },
    })

    const hasMore = photos.length > take
    const effectivePhotos = hasMore ? photos.slice(0, take) : photos
    const nextCursor = hasMore ? effectivePhotos[effectivePhotos.length - 1]?.id : null

    const total = await prisma.photo.count({ where })

    console.log(`[repo:getEventPhotosPaginated] eventId=${eventId} cursor=${cursor} sort=${sort} take=${take} momentSlug=${momentSlug} returned=${effectivePhotos.length} total=${total} durationMs=${Date.now() - start}`)

    return {
      photos: effectivePhotos,
      nextCursor,
      total,
    }
  },

  async listEventsByOwnerEmail(ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const normalizedEmail = ownerEmail.toLowerCase().trim()
    const owner = await resolveCanonicalOwner(ownerEmail)

    const where = owner
      ? {
          OR: [
            { ownerId: owner.id },
            { ownerEmail: { equals: normalizedEmail, mode: 'insensitive' } },
          ],
        }
      : { ownerEmail: { equals: normalizedEmail, mode: 'insensitive' } }

    const events = await prisma.event.findMany({
      where,
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        photos: {
          where: { status: 'VISIBLE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: {
          select: { photos: { where: { status: 'VISIBLE' } } },
        },
      },
    })

    return events.map((event) => {
      const { _count, ...eventRecord } = event
      return normalizeEventRecord({
        event: eventRecord,
        photos: [],
        photoCount: _count.photos,
        latestPhotoUrl: event.photos[0]?.url || null,
      })
    })
  },

  async getEventBySlugAndOwner(slug, ownerEmail) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const normalizedEmail = ownerEmail.toLowerCase().trim()
    const owner = await resolveCanonicalOwner(ownerEmail)

    const where = owner
      ? {
          slug,
          OR: [
            { ownerId: owner.id },
            { ownerEmail: { equals: normalizedEmail, mode: 'insensitive' } },
          ],
        }
      : { slug, ownerEmail: { equals: normalizedEmail, mode: 'insensitive' } }

    const event = await prisma.event.findFirst({
      where,
      include: {
        photos: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        moments: {
          orderBy: { sortOrder: 'asc' },
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

    return normalizeEventRecord({
      event,
      photos: event.photos,
      photoCount: visiblePhotoCount,
      latestPhotoUrl: event.photos[0]?.url || null,
      moments: event.moments,
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

    const normalizedEmail = ownerEmail.toLowerCase().trim()
    const owner = await resolveCanonicalOwner(ownerEmail)
    const isOwner =
      event?.ownerEmail?.toLowerCase() === normalizedEmail ||
      (owner && event?.ownerId === owner.id)

    if (!event || !isOwner) {
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

    const normalizedEmail = ownerEmail.toLowerCase().trim()
    const owner = await resolveCanonicalOwner(ownerEmail)
    const isOwner =
      event?.ownerEmail?.toLowerCase() === normalizedEmail ||
      (owner && event?.ownerId === owner.id)

    if (!event || !isOwner) {
      return null
    }

    await prisma.photo.delete({ where: { id: photoId } })
    await syncEventCoverPhoto(prisma, photo.eventId)

    return normalizePhotoRecord(photo)
  },

  async getEventById(eventId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, slug: true } })
    return event ? { id: event.id, slug: event.slug } : null
  },

  /**
   * ALL photo ids for an event — deliberately uncapped.
   *
   * `getEventBySlug` / `getEventBySlugAndOwner` load `photos` with `take: 100`
   * for presentation, and Production already holds an event with 186 photos.
   * Derivative cleanup must therefore never use those lists as its inventory,
   * so this returns the authoritative id set and nothing else: no url, no
   * storedName, no filename.
   */
  async listPhotoIdsByEventId(eventId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const photos = await prisma.photo.findMany({
      where: { eventId },
      select: { id: true },
    })

    return photos.map((photo) => photo.id)
  },

  /**
   * ALL source-original storage references for an event — the authoritative,
   * uncapped inventory for DESTRUCTIVE cleanup (STEP 7.15d.2).
   *
   * Deliberately separate from `listPhotoIdsByEventId`, which serves
   * best-effort derivative cleanup. These two have different failure
   * semantics on purpose and must stay visibly distinct:
   *
   *   - a derivative-inventory failure is survivable — derivatives are
   *     reproducible caches with a reconciliation sweep behind them;
   *   - a SOURCE-inventory failure is not — `Photo.url` is the only mapping
   *     from an event to its original objects, and once the event row
   *     cascades away nothing in application state can reconstruct it.
   *
   * Consequently this method NEVER degrades. It does not catch, does not
   * return partial rows, and does not substitute `[]` for a failure: the
   * caller must be able to tell "this event genuinely has no photos" from
   * "we could not find out". Query errors propagate untouched.
   *
   * Neither presentation reader may be used for this: `getEventBySlug` and
   * `getEventBySlugAndOwner` both load `photos` with `take: 100`, while
   * Production already holds an event with 186 photos.
   *
   * Returns urls only — no id, storedName, originalName, caption,
   * uploaderName, size or mimeType. Status is intentionally NOT filtered:
   * hard event deletion removes the whole event, so HIDDEN originals are in
   * scope exactly like VISIBLE ones.
   *
   * Server-only. Must never reach a DTO, a response, or a log line.
   *
   * @param {string} eventId
   * @returns {Promise<string[]>} every Photo.url for the event, unordered
   */
  async listPhotoSourcesByEventId(eventId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    // No take/skip/cursor/orderBy: deletion is order-independent, and any
    // pagination here would reintroduce exactly the truncation this exists
    // to remove.
    const photos = await prisma.photo.findMany({
      where: { eventId },
      select: { url: true },
    })

    return photos.map((photo) => photo.url)
  },

  async createPhoto({ eventId, originalName, storedName, mimeType, size, url, uploaderName, caption, momentId }) {
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
        momentId: momentId || null,
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

  async getPhotoById(photoId) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }

    const photo = await prisma.photo.findUnique({ where: { id: photoId } })

    if (!photo) {
      return null
    }

    return normalizePhotoRecord(photo)
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

  async listPrivateAssetsByEventId(eventId) {
    const prisma = await getPrismaClient()
    if (!prisma) return []
    const assets = await prisma.privateAsset.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    })
    return assets.map(normalizePrivateAssetRecord)
  },

  async createPrivateAsset({ eventId, originalName, storedName, mimeType, size, url, uploadedByRole }) {
    const prisma = await getPrismaClient()
    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }
    const asset = await prisma.privateAsset.create({
      data: {
        eventId,
        originalName,
        storedName,
        mimeType,
        size,
        url,
        uploadedByRole: uploadedByRole || 'owner',
      },
    })
    return normalizePrivateAssetRecord(asset)
  },

  async getPrivateAssetById(assetId) {
    const prisma = await getPrismaClient()
    if (!prisma) return null
    const asset = await prisma.privateAsset.findUnique({ where: { id: assetId } })
    if (!asset) return null
    return normalizePrivateAssetRecord(asset)
  },

  async deletePrivateAssetById(assetId) {
    const prisma = await getPrismaClient()
    if (!prisma) return null
    const asset = await prisma.privateAsset.findUnique({ where: { id: assetId } })
    if (!asset) return null
    await prisma.privateAsset.delete({ where: { id: assetId } })
    return normalizePrivateAssetRecord(asset)
  },

  async setPhotographerUploadToken(slug, { tokenHash, expiresAt }) {
    const prisma = await getPrismaClient()
    if (!prisma) {
      throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    }
    const event = await prisma.event.findUnique({ where: { slug } })
    if (!event) return null
    const updatedEvent = await prisma.event.update({
      where: { slug },
      data: {
        photographerUploadTokenHash: tokenHash || null,
        photographerUploadTokenExpiresAt: expiresAt || null,
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

  async getEventByPhotographerUploadTokenHash(tokenHash) {
    const prisma = await getPrismaClient()
    if (!prisma) return null
    const event = await prisma.event.findFirst({
      where: { photographerUploadTokenHash: tokenHash },
    })
    if (!event) return null
    return normalizeEventRecord({
      event,
      photos: [],
      photoCount: 0,
      latestPhotoUrl: null,
    })
  },

  async listPrivateAssetsByEventIdAndRole(eventId, uploadedByRole) {
    const prisma = await getPrismaClient()
    if (!prisma) return []
    const assets = await prisma.privateAsset.findMany({
      where: { eventId, uploadedByRole },
      orderBy: { createdAt: 'desc' },
    })
    return assets.map(normalizePrivateAssetRecord)
  },

  async listEventMoments(eventId) {
    const prisma = await getPrismaClient()
    if (!prisma) return []
    const moments = await prisma.eventMoment.findMany({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
    })
    return moments.map(normalizeEventMomentRecord)
  },

  async createEventMoment(eventId, { name, slug, sortOrder = 0 }) {
    const prisma = await getPrismaClient()
    if (!prisma) throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    const moment = await prisma.eventMoment.create({
      data: { eventId, name, slug, sortOrder },
    })
    return normalizeEventMomentRecord(moment)
  },

  async updateEventMoment(momentId, { name, sortOrder }) {
    const prisma = await getPrismaClient()
    if (!prisma) throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    const data = { updatedAt: new Date() }
    if (name !== undefined) data.name = name
    if (sortOrder !== undefined) data.sortOrder = sortOrder
    const moment = await prisma.eventMoment.update({
      where: { id: momentId },
      data,
    })
    return normalizeEventMomentRecord(moment)
  },

  async deleteEventMoment(momentId) {
    const prisma = await getPrismaClient()
    if (!prisma) throw new Error('Prisma repository requested but DATABASE_URL/client is unavailable')
    await prisma.eventMoment.delete({ where: { id: momentId } })
    return { id: momentId }
  },

  async countEventMoments(eventId) {
    const prisma = await getPrismaClient()
    if (!prisma) return 0
    return prisma.eventMoment.count({ where: { eventId } })
  },
}
