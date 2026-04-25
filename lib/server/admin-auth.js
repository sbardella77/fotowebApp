import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { getAdminCredentialStore } from './admin-credential-store'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const ADMIN_COOKIE_NAME = 'event_gallery_admin_session'

const secureCompare = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

const getSessionSecret = async () => {
  if (process.env.ADMIN_SESSION_SECRET) {
    return process.env.ADMIN_SESSION_SECRET
  }

  const store = await getAdminCredentialStore()
  const seed = await store.getSessionSecretSeed()
  // Strengthen weak/predictable fallbacks so tokens remain hard to forge
  // even when ADMIN_SESSION_SECRET is not explicitly configured.
  if (!seed || seed.length < 32) {
    console.warn('[security] ADMIN_SESSION_SECRET is not set. Using a strengthened fallback. Set ADMIN_SESSION_SECRET for production.')
  }
  return createHash('sha256').update(seed || 'snaprooms-admin-fallback').digest('hex')
}

const encodePayload = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const decodePayload = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

export const getAdminAuthStatus = async () => {
  const store = await getAdminCredentialStore()
  return store.getStatus()
}

export const setupLocalAdminPassword = async (password) => {
  const store = await getAdminCredentialStore()
  return store.setup(password)
}

export const verifyAdminPassword = async (password) => {
  const store = await getAdminCredentialStore()
  return store.verify(password)
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
