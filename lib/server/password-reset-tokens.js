import { createHash } from 'crypto'
import {
  generatePasswordResetToken,
  getPasswordResetTokenExpiry,
  hashPasswordResetToken,
} from './owner-auth'

/**
 * Secure password reset / setup token lifecycle.
 *
 * Tokens are opaque, random, URL-safe strings. Only their SHA-256 hashes are
 * stored in the database. Creating a new token invalidates any previous unused
 * tokens for the same owner and purpose, and tokens are marked used after the
 * first successful consumption.
 */

function hashClientIp(clientIp) {
  return createHash('sha256').update(clientIp).digest('hex')
}

export async function createPasswordResetTokenForOwner({
  prisma,
  ownerId,
  purpose = 'password_reset',
  clientIp = 'unknown',
}) {
  const rawToken = generatePasswordResetToken()
  const tokenHash = hashPasswordResetToken(rawToken)
  const requestedIpHash = hashClientIp(clientIp)

  await prisma.ownerPasswordResetToken.updateMany({
    where: { ownerId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  })

  await prisma.ownerPasswordResetToken.create({
    data: {
      ownerId,
      tokenHash,
      purpose,
      expiresAt: getPasswordResetTokenExpiry(purpose),
      requestedIpHash,
    },
  })

  return rawToken
}

export async function findValidPasswordResetToken({ prisma, rawToken, purpose = 'password_reset' }) {
  if (!rawToken || !prisma) return null
  const tokenHash = hashPasswordResetToken(rawToken)
  return prisma.ownerPasswordResetToken.findFirst({
    where: {
      tokenHash,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { owner: true },
  })
}

export async function invalidateSiblingPasswordResetTokens(tx, ownerId, excludeTokenId) {
  return tx.ownerPasswordResetToken.updateMany({
    where: { ownerId, usedAt: null, id: { not: excludeTokenId } },
    data: { usedAt: new Date() },
  })
}
