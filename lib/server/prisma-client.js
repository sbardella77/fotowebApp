let prismaClientInstance = globalThis.__eventGalleryPrismaClient || null

const normalizeDriver = (value, fallback) => {
  const candidate = String(value || fallback).toLowerCase()
  return ['local', 'prisma', 'auto', 'env'].includes(candidate) ? candidate : fallback
}

export const getDataAccessDriver = () => normalizeDriver(process.env.DATA_ACCESS_DRIVER, 'local')

export const getAdminAuthDriver = () => {
  if (process.env.ADMIN_PASSWORD) {
    return 'env'
  }

  return normalizeDriver(process.env.ADMIN_AUTH_DRIVER, 'local')
}

export const getPrismaClient = async () => {
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
    console.warn('Prisma client unavailable.', error)
    return null
  }
}
