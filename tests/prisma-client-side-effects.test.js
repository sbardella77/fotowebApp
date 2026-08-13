import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// lib/server/prisma-client.js used to fire two ownership-repair jobs
// (fire-and-forget) on first PrismaClient construction. STEP 5.13 removed
// that coupling: getPrismaClient() must only construct/cache/return a
// client. These tests guard the invariant behaviorally — via mocks and call
// assertions — rather than via source grep, so a regression that
// re-introduces the coupling through any call path fails a real assertion.

const PrismaClientMock = vi.fn().mockImplementation(function FakePrismaClient() {
  return { __fakePrismaClient: true }
})

vi.mock('@prisma/client', () => ({
  PrismaClient: PrismaClientMock,
}))

const repairLegacyOwnershipMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/repair-legacy-ownership', () => ({
  repairLegacyOwnership: repairLegacyOwnershipMock,
}))

const repairDuplicateOwnerAssignmentsMock = vi.fn().mockResolvedValue({ duplicateGroups: 0, eventsReassigned: 0 })
vi.mock('@/lib/server/owner-resolution', () => ({
  repairDuplicateOwnerAssignments: repairDuplicateOwnerAssignmentsMock,
}))

const originalDatabaseUrl = process.env.DATABASE_URL

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.__eventGalleryPrismaClient = undefined
})

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl
  }
  globalThis.__eventGalleryPrismaClient = undefined
})

describe('prisma-client.js — build-safety invariant (STEP 5.13 regression guard)', () => {
  it('A. bare import performs zero PrismaClient construction and zero repair calls', async () => {
    vi.resetModules()
    delete process.env.DATABASE_URL

    await import('@/lib/server/prisma-client')

    expect(PrismaClientMock).not.toHaveBeenCalled()
    expect(repairLegacyOwnershipMock).not.toHaveBeenCalled()
    expect(repairDuplicateOwnerAssignmentsMock).not.toHaveBeenCalled()
  })

  it('B. first getPrismaClient() call constructs the client and calls neither repair function', async () => {
    vi.resetModules()
    process.env.DATABASE_URL = 'postgresql://fake:fake@127.0.0.1:1/fake'

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const client = await getPrismaClient()

    expect(client).toEqual({ __fakePrismaClient: true })
    expect(PrismaClientMock).toHaveBeenCalledTimes(1)
    expect(repairLegacyOwnershipMock).not.toHaveBeenCalled()
    expect(repairDuplicateOwnerAssignmentsMock).not.toHaveBeenCalled()
  })

  it('C. second getPrismaClient() call reuses the cached client with zero additional side effects', async () => {
    vi.resetModules()
    process.env.DATABASE_URL = 'postgresql://fake:fake@127.0.0.1:1/fake'

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const first = await getPrismaClient()
    const second = await getPrismaClient()

    expect(second).toBe(first)
    expect(PrismaClientMock).toHaveBeenCalledTimes(1)
    expect(repairLegacyOwnershipMock).not.toHaveBeenCalled()
    expect(repairDuplicateOwnerAssignmentsMock).not.toHaveBeenCalled()
  })

  it('D. DATABASE_URL absent → returns null without constructing a client (pre-existing behavior invariant)', async () => {
    vi.resetModules()
    delete process.env.DATABASE_URL

    const { getPrismaClient } = await import('@/lib/server/prisma-client')
    const client = await getPrismaClient()

    expect(client).toBeNull()
    expect(PrismaClientMock).not.toHaveBeenCalled()
  })
})
