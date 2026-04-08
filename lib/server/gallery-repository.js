import { mockGalleryRepository } from './mock-db'
import { getDataAccessDriver, getPrismaClient } from './prisma-client'
import { prismaGalleryRepository } from './prisma-gallery-repository'

const resolveGalleryRepository = async () => {
  const driver = getDataAccessDriver()

  if (driver === 'local') {
    return {
      repository: mockGalleryRepository,
      mode: 'local',
    }
  }

  if (driver === 'prisma') {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('DATA_ACCESS_DRIVER=prisma requires DATABASE_URL and prisma client generation/migrations.')
    }

    return {
      repository: prismaGalleryRepository,
      mode: 'prisma',
    }
  }

  const prisma = await getPrismaClient()

  return prisma
    ? {
        repository: prismaGalleryRepository,
        mode: 'prisma',
      }
    : {
        repository: mockGalleryRepository,
        mode: 'local',
      }
}

export const getGalleryRepository = async () => {
  const { repository } = await resolveGalleryRepository()
  return repository
}

export const getGalleryRepositoryMode = async () => {
  const { mode } = await resolveGalleryRepository()
  return mode
}
