import { randomBytes, createHash } from 'crypto'

const TOKEN_BYTES = 32

export function generatePhotographerUploadToken() {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

export function hashPhotographerUploadToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyPhotographerUploadToken(token, storedHash) {
  if (!token || !storedHash) return false
  return createHash('sha256').update(token).digest('hex') === storedHash
}
