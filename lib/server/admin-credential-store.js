import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { getAdminAuthDriver, getPrismaClient } from './prisma-client'

const DATA_DIRECTORY = path.join(process.cwd(), 'data')
const ADMIN_AUTH_FILE = path.join(DATA_DIRECTORY, 'admin-auth.json')
const PRIMARY_ADMIN_KEY = 'primary'

const hashPassword = (password, salt) => {
  return scryptSync(password, salt, 64).toString('hex')
}

const secureCompare = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

const readLocalAdminConfig = async () => {
  try {
    const content = await readFile(ADMIN_AUTH_FILE, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

const writeLocalAdminConfig = async (payload) => {
  await mkdir(DATA_DIRECTORY, { recursive: true })
  await writeFile(ADMIN_AUTH_FILE, JSON.stringify(payload, null, 2), 'utf8')
}

const envAdminCredentialStore = {
  async getStatus() {
    return {
      configured: Boolean(process.env.ADMIN_PASSWORD),
      source: 'env',
    }
  },

  async setup() {
    throw new Error('Admin password is controlled by environment configuration.')
  },

  async verify(password) {
    return secureCompare(password, process.env.ADMIN_PASSWORD || '')
  },

  async getSessionSecretSeed() {
    return process.env.ADMIN_PASSWORD || ''
  },
}

const localAdminCredentialStore = {
  async getStatus() {
    const localConfig = await readLocalAdminConfig()

    return {
      configured: Boolean(localConfig),
      source: localConfig ? 'local' : null,
    }
  },

  async setup(password) {
    const existing = await readLocalAdminConfig()

    if (existing) {
      throw new Error('Admin password is already configured.')
    }

    const salt = randomBytes(16).toString('hex')
    const hash = hashPassword(password, salt)

    await writeLocalAdminConfig({
      salt,
      hash,
      updatedAt: new Date().toISOString(),
    })

    return {
      configured: true,
      source: 'local',
    }
  },

  async verify(password) {
    const localConfig = await readLocalAdminConfig()

    if (!localConfig) {
      return false
    }

    const candidateHash = hashPassword(password, localConfig.salt)
    return secureCompare(candidateHash, localConfig.hash)
  },

  async getSessionSecretSeed() {
    const localConfig = await readLocalAdminConfig()
    return localConfig?.hash || `${process.env.NEXT_PUBLIC_BASE_URL || 'local'}:event-gallery-admin`
  },
}

const prismaAdminCredentialStore = {
  async getStatus() {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return {
        configured: false,
        source: 'prisma',
      }
    }

    const credential = await prisma.adminCredential.findUnique({ where: { key: PRIMARY_ADMIN_KEY } })

    return {
      configured: Boolean(credential),
      source: 'prisma',
    }
  },

  async setup(password) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      throw new Error('Prisma admin auth requested but DATABASE_URL/client is unavailable.')
    }

    const existing = await prisma.adminCredential.findUnique({ where: { key: PRIMARY_ADMIN_KEY } })

    if (existing) {
      throw new Error('Admin password is already configured.')
    }

    const salt = randomBytes(16).toString('hex')
    const passwordHash = hashPassword(password, salt)

    await prisma.adminCredential.create({
      data: {
        key: PRIMARY_ADMIN_KEY,
        passwordSalt: salt,
        passwordHash,
      },
    })

    return {
      configured: true,
      source: 'prisma',
    }
  },

  async verify(password) {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return false
    }

    const credential = await prisma.adminCredential.findUnique({ where: { key: PRIMARY_ADMIN_KEY } })

    if (!credential) {
      return false
    }

    const candidateHash = hashPassword(password, credential.passwordSalt)
    return secureCompare(candidateHash, credential.passwordHash)
  },

  async getSessionSecretSeed() {
    const prisma = await getPrismaClient()

    if (!prisma) {
      return `${process.env.NEXT_PUBLIC_BASE_URL || 'local'}:event-gallery-admin`
    }

    const credential = await prisma.adminCredential.findUnique({ where: { key: PRIMARY_ADMIN_KEY } })
    return credential?.passwordHash || `${process.env.NEXT_PUBLIC_BASE_URL || 'local'}:event-gallery-admin`
  },
}

export const getAdminCredentialStore = async () => {
  const driver = getAdminAuthDriver()

  if (driver === 'env') {
    return envAdminCredentialStore
  }

  if (driver === 'prisma') {
    return prismaAdminCredentialStore
  }

  if (driver === 'auto') {
    const prisma = await getPrismaClient()
    return prisma ? prismaAdminCredentialStore : localAdminCredentialStore
  }

  return localAdminCredentialStore
}
