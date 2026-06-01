import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { getAdminCredentialStore } from './admin-credential-store'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const OWNER_COOKIE_NAME = 'snaprooms_owner_session'

const secureCompare = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

const getSessionSecret = async () => {
  if (process.env.OWNER_SESSION_SECRET) {
    return process.env.OWNER_SESSION_SECRET
  }
  if (process.env.ADMIN_SESSION_SECRET) {
    return process.env.ADMIN_SESSION_SECRET
  }

  // In production, fail loudly instead of using a predictable fallback.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OWNER_SESSION_SECRET missing in production. Set OWNER_SESSION_SECRET or ADMIN_SESSION_SECRET environment variable.')
  }

  const store = await getAdminCredentialStore()
  const seed = await store.getSessionSecretSeed()
  // Strengthen weak/predictable fallbacks so tokens remain hard to forge
  // even when OWNER_SESSION_SECRET / ADMIN_SESSION_SECRET are not explicitly configured.
  if (!seed || seed.length < 32) {
    console.warn('[security] OWNER_SESSION_SECRET is not set. Using a strengthened fallback. Set OWNER_SESSION_SECRET or ADMIN_SESSION_SECRET for production.')
  }
  return createHash('sha256').update(seed || 'snaprooms-owner-fallback').digest('hex')
}

const encodePayload = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url')
const decodePayload = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

export const createOwnerSessionToken = async (email) => {
  const payload = {
    email: email.toLowerCase().trim(),
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = encodePayload(payload)
  const signature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  return `${encodedPayload}.${signature}`
}

export const verifyOwnerSessionToken = async (token) => {
  if (!token) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  if (!secureCompare(signature, expectedSignature)) {
    return null
  }

  try {
    const payload = decodePayload(encodedPayload)

    if (Number(payload?.exp) > Date.now() && payload?.email) {
      return payload.email
    }

    return null
  } catch {
    return null
  }
}

export const getOwnerCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
})

const RECOVERY_MAX_AGE_SECONDS = 60 * 30

export const createRecoveryToken = async (email) => {
  const payload = {
    email: email.toLowerCase().trim(),
    exp: Date.now() + RECOVERY_MAX_AGE_SECONDS * 1000,
    purpose: 'recover',
  }
  const encodedPayload = encodePayload(payload)
  const signature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  return `${encodedPayload}.${signature}`
}

export const verifyRecoveryToken = async (token) => {
  if (!token) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  if (!secureCompare(signature, expectedSignature)) {
    return null
  }

  try {
    const payload = decodePayload(encodedPayload)

    if (Number(payload?.exp) > Date.now() && payload?.email && payload?.purpose === 'recover') {
      return payload.email
    }

    return null
  } catch {
    return null
  }
}

const SETUP_MAX_AGE_SECONDS = 60 * 60 * 24

export const createSetupToken = async (email) => {
  const payload = {
    email: email.toLowerCase().trim(),
    exp: Date.now() + SETUP_MAX_AGE_SECONDS * 1000,
    purpose: 'setup',
  }
  const encodedPayload = encodePayload(payload)
  const signature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  return `${encodedPayload}.${signature}`
}

export const verifySetupToken = async (token) => {
  if (!token) {
    return null
  }

  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    return null
  }

  const expectedSignature = createHmac('sha256', await getSessionSecret()).update(encodedPayload).digest('hex')

  if (!secureCompare(signature, expectedSignature)) {
    return null
  }

  try {
    const payload = decodePayload(encodedPayload)

    if (Number(payload?.exp) > Date.now() && payload?.email && payload?.purpose === 'setup') {
      return payload.email
    }

    return null
  } catch {
    return null
  }
}
