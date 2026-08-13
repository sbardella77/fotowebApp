import { randomBytes, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

export { validatePassword, generateStrongPassword } from '@/lib/password-utils'

export async function hashPassword(password, salt) {
  const derivedKey = await scryptAsync(password, salt, 64)
  return derivedKey.toString('hex')
}

export async function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await hashPassword(password, salt)
  return { salt, hash }
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false
  const candidateHash = await hashPassword(password, salt)
  const leftBuffer = Buffer.from(candidateHash)
  const rightBuffer = Buffer.from(hash)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}
