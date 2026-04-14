import { randomBytes, createHash } from 'crypto'

const TOKEN_BYTES = 32

export function generateManagementToken() {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashManagementToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyManagementToken(token, storedHash) {
  if (!token || !storedHash) return false
  return createHash('sha256').update(token).digest('hex') === storedHash
}
