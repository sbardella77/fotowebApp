import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

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

export function validatePassword(password) {
  const errors = []
  if (password.length < 12) errors.push('At least 12 characters')
  if (!/[A-Z]/.test(password)) errors.push('One uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('One lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('One number')
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('One symbol')
  return { valid: errors.length === 0, errors }
}

export function generateStrongPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%^&*-_+=?'
  const all = upper + lower + numbers + symbols

  let password = ''
  password += upper[Math.floor(Math.random() * upper.length)]
  password += lower[Math.floor(Math.random() * lower.length)]
  password += numbers[Math.floor(Math.random() * numbers.length)]
  password += symbols[Math.floor(Math.random() * symbols.length)]

  for (let i = 4; i < 16; i++) {
    password += all[Math.floor(Math.random() * all.length)]
  }

  // Shuffle
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('')
}
