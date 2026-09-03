import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  classifyGalleryUploadActor,
  UPLOAD_ACTOR_OWNER,
  UPLOAD_ACTOR_GUEST,
} from '@/lib/server/gallery-upload-actor'

// classifyGalleryUploadActor is analytics attribution only — never
// authorization. It never throws, never blocks an upload, and only ever
// accepts server-resolved values (never a client-supplied payload field).

describe('classifyGalleryUploadActor', () => {
  it('1/2/3. no verified owner email (anonymous, no cookie, expired/invalid session) → guest', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: null,
      eventOwnerEmail: 'owner@example.com',
    })
    expect(result).toBe(UPLOAD_ACTOR_GUEST)
  })

  it('4. valid owner session matching the event owner → owner', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: 'owner@example.com',
      eventOwnerEmail: 'owner@example.com',
    })
    expect(result).toBe(UPLOAD_ACTOR_OWNER)
  })

  it('matching email is case-insensitive and whitespace-tolerant', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: '  Owner@Example.com  ',
      eventOwnerEmail: 'owner@example.com',
    })
    expect(result).toBe(UPLOAD_ACTOR_OWNER)
  })

  it('5. valid owner session for a DIFFERENT owner/event → guest', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: 'someone-else@example.com',
      eventOwnerEmail: 'owner@example.com',
    })
    expect(result).toBe(UPLOAD_ACTOR_GUEST)
  })

  it('6. ownerless event (Event.ownerEmail is null) → guest, even with a valid owner session', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: 'owner@example.com',
      eventOwnerEmail: null,
    })
    expect(result).toBe(UPLOAD_ACTOR_GUEST)
  })

  it('both null/undefined → guest, never throws', () => {
    expect(() => classifyGalleryUploadActor({ verifiedOwnerEmail: null, eventOwnerEmail: null })).not.toThrow()
    expect(classifyGalleryUploadActor({ verifiedOwnerEmail: null, eventOwnerEmail: null })).toBe(UPLOAD_ACTOR_GUEST)
    expect(classifyGalleryUploadActor({ verifiedOwnerEmail: undefined, eventOwnerEmail: undefined })).toBe(
      UPLOAD_ACTOR_GUEST,
    )
  })

  it('empty-string emails are treated as absent → guest', () => {
    expect(classifyGalleryUploadActor({ verifiedOwnerEmail: '', eventOwnerEmail: 'owner@example.com' })).toBe(
      UPLOAD_ACTOR_GUEST,
    )
    expect(classifyGalleryUploadActor({ verifiedOwnerEmail: 'owner@example.com', eventOwnerEmail: '' })).toBe(
      UPLOAD_ACTOR_GUEST,
    )
  })

  it('7. the function signature has no client-payload parameter to override classification with', () => {
    // Structural guarantee: the only inputs are verifiedOwnerEmail (from the
    // server-side owner-session cookie verification) and eventOwnerEmail
    // (from the DB-loaded Event) — there is no third parameter through
    // which a request body/isOwner/actorType flag could influence the
    // result, even if a caller tried to pass one.
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: null,
      eventOwnerEmail: 'owner@example.com',
      // Attempting to smuggle a client-style override — must be ignored.
      isOwner: true,
      actorType: 'owner',
      uploadActorType: 'owner',
    })
    expect(result).toBe(UPLOAD_ACTOR_GUEST)
  })

  it('8. contributorId has no bearing on classification (not a recognized parameter)', () => {
    const result = classifyGalleryUploadActor({
      verifiedOwnerEmail: null,
      eventOwnerEmail: 'owner@example.com',
      contributorId: '11111111-1111-4111-8111-111111111111',
    })
    expect(result).toBe(UPLOAD_ACTOR_GUEST)
  })
})

// 12. Source-level contract: uploadActorType must never be read by any
// authorization, entitlement, or access-control logic — it is analytics
// attribution only. A future change that starts gating features on it
// would silently turn "guest" into a second-class access tier, which is
// explicitly forbidden by this field's contract.
describe('uploadActorType is never used for authorization (source contract)', () => {
  const GUARDED_FILES = [
    'lib/event-access.js',
    'lib/server/entitlements.js',
    'lib/server/download-derivative.js',
    'lib/server/display-derivative.js',
    'lib/server/csrf.js',
    'lib/server/rate-limiter.js',
    'lib/server/owner-auth.js',
    'lib/server/admin-auth.js',
  ]

  for (const relativePath of GUARDED_FILES) {
    it(`${relativePath} does not reference uploadActorType`, () => {
      const source = fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
      expect(source).not.toContain('uploadActorType')
    })
  }

  it('the resolver module itself documents the analytics-only contract', () => {
    const source = fs.readFileSync(new URL('../lib/server/gallery-upload-actor.js', import.meta.url), 'utf8')
    expect(source).toMatch(/never authorization/i)
    expect(source).toMatch(/never (blocks|degrades|rejects)/i)
  })
})
