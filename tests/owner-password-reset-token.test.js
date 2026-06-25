import { describe, it, expect } from 'vitest'
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
  getPasswordResetTokenExpiry,
} from '@/lib/server/owner-auth'

describe('Password reset token helpers', () => {
  it('generates opaque URL-safe tokens', () => {
    const token = generatePasswordResetToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(40)
    expect(token).not.toContain('+')
    expect(token).not.toContain('/')
    expect(token).not.toContain('=')
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces unique tokens', () => {
    const tokens = new Set(Array.from({ length: 20 }, generatePasswordResetToken))
    expect(tokens.size).toBe(20)
  })

  it('hashes tokens deterministically', () => {
    const token = generatePasswordResetToken()
    const a = hashPasswordResetToken(token)
    const b = hashPasswordResetToken(token)
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('hashes different tokens to different digests', () => {
    const a = hashPasswordResetToken(generatePasswordResetToken())
    const b = hashPasswordResetToken(generatePasswordResetToken())
    expect(a).not.toBe(b)
  })

  it('expires password reset tokens in 30 minutes', () => {
    const before = Date.now()
    const expiry = getPasswordResetTokenExpiry('password_reset')
    const after = Date.now()
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 29 * 60 * 1000)
    expect(expiry.getTime()).toBeLessThanOrEqual(after + 31 * 60 * 1000)
  })

  it('expires setup tokens in 24 hours', () => {
    const before = Date.now()
    const expiry = getPasswordResetTokenExpiry('setup_password')
    const after = Date.now()
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000)
    expect(expiry.getTime()).toBeLessThanOrEqual(after + 25 * 60 * 60 * 1000)
  })
})
