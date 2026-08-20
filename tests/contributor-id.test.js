import { describe, it, expect } from 'vitest'
import { normalizeContributorId } from '@/lib/server/contributor-id'
import { uploadInitSchema } from '@/lib/server/schemas'

// Anonymous contributor id — best-effort, analytics-only, never
// authoritative for security/billing/gating. A malformed/missing value must
// normalize to null, never throw, and never block an upload.

describe('normalizeContributorId', () => {
  it('valid UUID v4 (lowercase) → preserved', () => {
    expect(normalizeContributorId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('valid UUID v4 (uppercase) → normalized to lowercase', () => {
    expect(normalizeContributorId('11111111-1111-4111-8111-111111111111'.toUpperCase())).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('valid UUID v4 with surrounding whitespace → trimmed and preserved', () => {
    expect(normalizeContributorId('  11111111-1111-4111-8111-111111111111  ')).toBe(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('malformed string → null', () => {
    expect(normalizeContributorId('not-a-uuid')).toBeNull()
  })

  it('email-like string → null (never accepts PII-shaped input)', () => {
    expect(normalizeContributorId('guest@example.com')).toBeNull()
  })

  it('UUID v1/v5-shaped string (wrong version nibble) → null', () => {
    // Version nibble must be "4" — this is a v1-shaped UUID otherwise.
    expect(normalizeContributorId('11111111-1111-1111-8111-111111111111')).toBeNull()
  })

  it('UUID with wrong variant nibble → null', () => {
    // Variant nibble must be one of 8/9/a/b.
    expect(normalizeContributorId('11111111-1111-4111-1111-111111111111')).toBeNull()
  })

  it('missing value (undefined) → null', () => {
    expect(normalizeContributorId(undefined)).toBeNull()
  })

  it('null value → null', () => {
    expect(normalizeContributorId(null)).toBeNull()
  })

  it('empty string → null', () => {
    expect(normalizeContributorId('')).toBeNull()
  })

  it('non-string types (number, object, array, boolean) → null, never throws', () => {
    expect(normalizeContributorId(12345)).toBeNull()
    expect(normalizeContributorId({ id: '11111111-1111-4111-8111-111111111111' })).toBeNull()
    expect(normalizeContributorId(['11111111-1111-4111-8111-111111111111'])).toBeNull()
    expect(normalizeContributorId(true)).toBeNull()
  })

  it('overly long string → null', () => {
    expect(normalizeContributorId('1'.repeat(500))).toBeNull()
  })
})

// uploadInitSchema (lib/server/schemas.js) must never throw because of
// contributorId's shape — a malformed value must never abort the whole
// /api/uploads/init request. Real format validation happens only in
// normalizeContributorId(), applied separately after this parse succeeds.
describe('uploadInitSchema — contributorId never blocks parsing', () => {
  const BASE_PAYLOAD = {
    eventSlug: 'wedding-2026',
    fileName: 'photo.jpg',
    fileSize: 1024,
    mimeType: 'image/jpeg',
    totalChunks: 1,
  }

  it('accepts a payload with a valid contributorId', () => {
    const result = uploadInitSchema.parse({
      ...BASE_PAYLOAD,
      contributorId: '11111111-1111-4111-8111-111111111111',
    })
    expect(result.contributorId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('accepts a payload with a malformed contributorId (never throws)', () => {
    expect(() =>
      uploadInitSchema.parse({ ...BASE_PAYLOAD, contributorId: 'not-a-uuid' }),
    ).not.toThrow()
  })

  it('accepts a payload with a non-string contributorId (never throws)', () => {
    expect(() =>
      uploadInitSchema.parse({ ...BASE_PAYLOAD, contributorId: { evil: true } }),
    ).not.toThrow()
  })

  it('accepts a payload with contributorId omitted entirely', () => {
    expect(() => uploadInitSchema.parse({ ...BASE_PAYLOAD })).not.toThrow()
  })
})
