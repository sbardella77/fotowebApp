import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const DATA_DIRECTORY = path.join(process.cwd(), 'data')
const ADMIN_AUTH_FILE = path.join(DATA_DIRECTORY, 'admin-auth.json')
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const ADMIN_COOKIE_NAME = 'event_gallery_admin_session'

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

const getSessionSecret = async () => {
  if (process.env.ADMIN_SESSION_SECRET) {
    return process.env.ADMIN_SESSION_SECRET
  }

  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD
  }

  const localConfig = await readLocalAdminConfig()
  return localConfig?.hash || `${process.env.NEXT_PUBLIC_BASE_URL || 'local'}:event-gallery-admin`
}

const encodePayload = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const decodePayload = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

export const getAdminAuthStatus = async () => {
  if (process.env.ADMIN_PASSWORD) {
    return {
      configured: true,
      source: 'env',
    }
  }

  const localConfig = await readLocalAdminConfig()

  return {
    configured: Boolean(localConfig),
    source: localConfig ? 'local' : null,
  }
}

export const setupLocalAdminPassword = async (password) => {
  if (process.env.ADMIN_PASSWORD) {
    throw new Error('Admin password is controlled by environment configuration.')
  }

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
}

export const verifyAdminPassword = async (password) => {
  if (process.env.ADMIN_PASSWORD) {
    return secureCompare(password, process.env.ADMIN_PASSWORD)
  }

  const localConfig = await readLocalAdminConfig()

  if (!localConfig) {
    return false
  }

  const candidateHash = hashPassword(password, localConfig.salt)
  return secureCompare(candidateHash, localConfig.hash)
}

export const createAdminSessionToken = async () => {
  const payload = {
    role: 'admin',
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = encodePayload(payload)
  const signature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  return `${encodedPayload}.${signature}`
}

export const verifyAdminSessionToken = async (token) => {
  if (!token) {
    return false
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return false
  }

  const expectedSignature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  if (!secureCompare(signature, expectedSignature)) {
    return false
  }

  try {
    const payload = decodePayload(encodedPayload)
    return payload?.role === 'admin' && Number(payload?.exp) > Date.now()
  } catch {
    return false
  }
}

export const getAdminCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
})
