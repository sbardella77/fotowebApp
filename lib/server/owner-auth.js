import { createHmac, timingSafeEqual } from 'crypto'
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

  const store = await getAdminCredentialStore()
  return store.getSessionSecretSeed()
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
