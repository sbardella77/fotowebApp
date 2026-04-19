import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

export { validatePassword, generateStrongPassword } from '@/lib/password-utils'

export function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex')
}

export function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = hashPassword(password, salt)
  return { salt, hash }
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false
  const candidateHash = hashPassword(password, salt)
  const leftBuffer = Buffer.from(candidateHash)
  const rightBuffer = Buffer.from(hash)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
