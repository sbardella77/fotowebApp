import { describe, it, expect, vi, beforeEach } from 'vitest'

// owner-resolution.js resolves the canonical owner and, on findMany duplicate
// scans, includes an `_count.events` field only for resolveCanonicalOwner's
// own query. We keep the fixture shape close enough for both call sites.
const ownersByEmail = new Map()

const findManyMock = vi.fn(async ({ where }) => {
  const normalized = where?.email?.equals
  const list = ownersByEmail.get(normalized) || []
  return list.map((owner) => ({ ...owner, _count: { events: 0 } }))
})

vi.mock('@/lib/server/prisma-client', () => ({
  getPrismaClient: vi.fn().mockResolvedValue({
    owner: { findMany: (...args) => findManyMock(...args) },
  }),
}))

let findOwnerByEmailWithPassword

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  ownersByEmail.clear()
  ;({ findOwnerByEmailWithPassword } = await import('@/lib/server/owner-resolution'))
})

const setOwners = (email, owners) => {
  ownersByEmail.set(email, owners)
}

describe('findOwnerByEmailWithPassword — async verifyFn is always awaited (auth bypass regression guard)', () => {
  it('A. canonical owner + correct password → owner is returned', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
    ])

    const verifyFn = vi.fn(async (candidate) => candidate.passwordHash === 'hash-1')
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result?.id).toBe('owner-1')
  })

  it('B. canonical owner + wrong password → owner is NOT returned', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
    ])

    const verifyFn = vi.fn(async () => false)
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result).toBeNull()
  })

  it('C. an async verifyFn that resolves false must NOT be treated as truthy (Promise-is-always-truthy regression)', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
    ])

    // Deliberately returns a Promise<false>. A caller that forgot to await
    // verifyFn(...) would treat this Promise object as truthy and leak the
    // owner despite the password being wrong. This is the exact bypass this
    // migration must prevent.
    const verifyFn = (candidate) => Promise.resolve(false)
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result).toBeNull()
  })

  it('D. canonical fails, second candidate matches → second candidate is returned', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
      { id: 'owner-2', email: 'owner@example.com', passwordHash: 'hash-2', createdAt: new Date('2024-02-01') },
    ])

    const verifyFn = vi.fn(async (candidate) => candidate.passwordHash === 'hash-2')
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result?.id).toBe('owner-2')
  })

  it('E. all candidates fail → null', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
      { id: 'owner-2', email: 'owner@example.com', passwordHash: 'hash-2', createdAt: new Date('2024-02-01') },
    ])

    const verifyFn = vi.fn(async () => false)
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result).toBeNull()
  })

  it('F. a synchronous boolean-returning verifyFn still works (backward compatibility of the helper contract)', async () => {
    setOwners('owner@example.com', [
      { id: 'owner-1', email: 'owner@example.com', passwordHash: 'hash-1', createdAt: new Date('2024-01-01') },
    ])

    const verifyFn = (candidate) => candidate.passwordHash === 'hash-1'
    const result = await findOwnerByEmailWithPassword('owner@example.com', verifyFn)

    expect(result?.id).toBe('owner-1')
  })
})
