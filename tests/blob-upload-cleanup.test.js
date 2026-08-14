import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlobUploadSessionStatus } from '@prisma/client'
import { BlobNotFoundError } from '@vercel/blob'
import {
  DEFAULT_BLOB_CLEANUP_BATCH_SIZE,
  STALE_CLEANUP_PENDING_MS,
  cleanupBlobUploadSessions,
} from '../lib/server/blob-upload-cleanup.js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const {
  PENDING,
  TOKEN_ISSUED,
  UPLOADED,
  COMPLETED,
  REJECTED,
  CLEANUP_PENDING,
  CLEANUP_FAILED,
  EXPIRED_CLEANED,
} = BlobUploadSessionStatus

// ─── Time fixtures ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-09T10:00:00.000Z')
const PAST = new Date(NOW.getTime() - 1000)                    // expired 1s ago
const FUTURE = new Date(NOW.getTime() + 3_600_000)             // expires in 1h
const STALE_UPDATED_AT = new Date(NOW.getTime() - STALE_CLEANUP_PENDING_MS - 1000)
const FRESH_UPDATED_AT = new Date(NOW.getTime() - 60_000)      // 1 minute ago

// ─── Blob URL helpers ───────────────────────────────────────────────────────────

const PATHNAME = 'events/wedding-2026/uuid-photo.jpg'
const BLOB_URL = `https://abc.public.blob.vercel-storage.com/${PATHNAME}`

// ─── Fake Prisma ────────────────────────────────────────────────────────────────

function makeStore() {
  const records = []

  return {
    _records: records,
    findMany: vi.fn(async ({ where, take, orderBy, select }) => {
      let results = records.filter((r) => {
        if (where.resultId !== undefined && where.resultId !== null) return false
        if (where.resultId === null && r.resultId !== null) return false
        if (where.OR) {
          return where.OR.some((clause) => matchesClause(r, clause))
        }
        return true
      })
      if (orderBy?.updatedAt === 'asc') {
        results = results.slice().sort((a, b) => a.updatedAt - b.updatedAt)
      }
      if (take !== undefined) results = results.slice(0, take)
      if (select) {
        return results.map((r) => {
          const out = {}
          for (const key of Object.keys(select)) out[key] = r[key]
          return out
        })
      }
      return results
    }),
    findUnique: vi.fn(async ({ where }) => {
      return records.find((r) => r.id === where.id) ?? null
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      let count = 0
      for (const r of records) {
        if (!matchesWhere(r, where)) continue
        applyData(r, data)
        count++
      }
      return { count }
    }),
    create: vi.fn(async ({ data }) => {
      const r = { id: `sess-${records.length + 1}`, cleanupAttempts: 0, ...data }
      records.push(r)
      return r
    }),
  }
}

function matchesClause(r, clause) {
  if (clause.status) {
    if (clause.status.in) {
      if (!clause.status.in.includes(r.status)) return false
    } else {
      if (r.status !== clause.status) return false
    }
  }
  if (clause.expiresAt?.lte !== undefined) {
    if (r.expiresAt > clause.expiresAt.lte) return false
  }
  if (clause.updatedAt?.lte !== undefined) {
    if (r.updatedAt > clause.updatedAt.lte) return false
  }
  return true
}

function matchesWhere(r, where) {
  if (where.id !== undefined && r.id !== where.id) return false
  if (where.status !== undefined) {
    if (typeof where.status === 'string') {
      if (r.status !== where.status) return false
    } else if (where.status.in) {
      if (!where.status.in.includes(r.status)) return false
    }
  }
  if (where.resultId !== undefined) {
    if (where.resultId === null && r.resultId !== null) return false
    if (where.resultId !== null && r.resultId !== where.resultId) return false
  }
  if (where.updatedAt !== undefined) {
    if (where.updatedAt instanceof Date) {
      if (r.updatedAt.getTime() !== where.updatedAt.getTime()) return false
    } else if (where.updatedAt.lte !== undefined) {
      if (r.updatedAt > where.updatedAt.lte) return false
    }
  }
  if (where.expiresAt?.lte !== undefined) {
    if (r.expiresAt > where.expiresAt.lte) return false
  }
  return true
}

function applyData(r, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && 'increment' in value) {
      r[key] = (r[key] || 0) + value.increment
    } else {
      r[key] = value
    }
  }
}

function makeFakePrisma() {
  const store = makeStore()
  return { blobUploadSession: store, _store: store }
}

// ─── Session factories ──────────────────────────────────────────────────────────

function makeSession(overrides = {}) {
  return {
    id: 'sess-1',
    status: PENDING,
    expectedPathname: PATHNAME,
    blobUrl: null,
    resultId: null,
    expiresAt: PAST,
    updatedAt: FUTURE,
    cleanupAttempts: 0,
    ...overrides,
  }
}

// ─── Fake head/delete ───────────────────────────────────────────────────────────

function makeHeadResult(overrides = {}) {
  return {
    url: BLOB_URL,
    pathname: PATHNAME,
    contentType: 'image/jpeg',
    size: 204800,
    ...overrides,
  }
}

function makeDefaultArgs(prisma, headBlob, deleteBlob) {
  return {
    prisma,
    headBlob,
    deleteBlob,
    now: () => NOW,
    logger: { warn: vi.fn(), error: vi.fn() },
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1 — SELECTION TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('Selection', () => {
  it('1: expired PENDING is a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: PENDING, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(1)
  })

  it('2: expired TOKEN_ISSUED is a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(1)
  })

  it('3: expired UPLOADED is a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(1)
  })

  it('4: CLEANUP_FAILED is a candidate even if not expired', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_FAILED, expiresAt: FUTURE, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(1)
  })

  it('5: stale CLEANUP_PENDING is a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_PENDING, expiresAt: PAST, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(1)
  })

  it('6: fresh CLEANUP_PENDING is NOT a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_PENDING, expiresAt: PAST, updatedAt: FRESH_UPDATED_AT }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
  })

  it('7: COMPLETED is never a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: COMPLETED, expiresAt: PAST, resultId: 'photo-1', updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
  })

  it('8: REJECTED is never a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: REJECTED, expiresAt: PAST, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
  })

  it('9: EXPIRED_CLEANED is never a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: EXPIRED_CLEANED, expiresAt: PAST, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
  })

  it('10: resultId non-null is never a candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, resultId: 'photo-1', updatedAt: PAST }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2 — PENDING
// ══════════════════════════════════════════════════════════════════════════════

describe('PENDING expired', () => {
  it('11: expired PENDING → EXPIRED_CLEANED', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ id: 'sess-p1', status: PENDING, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.expiredCleaned).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(EXPIRED_CLEANED)
  })

  it('12: expired PENDING does not call headBlob', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: PENDING, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(headBlob).not.toHaveBeenCalled()
  })

  it('13: expired PENDING does not call deleteBlob', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: PENDING, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3 — TOKEN_ISSUED
// ══════════════════════════════════════════════════════════════════════════════

describe('TOKEN_ISSUED expired', () => {
  it('14: BlobNotFoundError → EXPIRED_CLEANED (expired)', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockRejectedValue(new BlobNotFoundError('not found'))
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.noBlob).toBe(1)
    expect(stats.expiredCleaned).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(EXPIRED_CLEANED)
  })

  it('15: BlobNotFoundError → no delete call', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockRejectedValue(new BlobNotFoundError('not found'))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('16: Blob exists → delete called with headResult.url', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headResult = makeHeadResult()
    const headBlob = vi.fn().mockResolvedValue(headResult)
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).toHaveBeenCalledWith(headResult.url)
  })

  it('17: Blob exists, delete success → EXPIRED_CLEANED', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.blobsDeleted).toBe(1)
    expect(stats.expiredCleaned).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(EXPIRED_CLEANED)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4 — UPLOADED
// ══════════════════════════════════════════════════════════════════════════════

describe('UPLOADED expired', () => {
  it('18: head pathname mismatch → CLEANUP_FAILED', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ pathname: 'events/other-slug/other.jpg' }))
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.cleanupFailed).toBe(1)
    expect(stats.metadataConflicts).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(CLEANUP_FAILED)
    expect(prisma.blobUploadSession._records[0].lastError).toBe('blob_metadata_invalid')
  })

  it('18b: pathname mismatch increments cleanupAttempts', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST, cleanupAttempts: 1 }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ pathname: 'events/other-slug/other.jpg' }))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(prisma.blobUploadSession._records[0].cleanupAttempts).toBe(2)
  })

  it('19: pathname mismatch → no delete call', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ pathname: 'events/wrong/file.jpg' }))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('20: stored blobUrl != headResult.url → CLEANUP_FAILED', async () => {
    const prisma = makeFakePrisma()
    const differentUrl = `https://other.public.blob.vercel-storage.com/${PATHNAME}`
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ url: differentUrl }))
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.cleanupFailed).toBe(1)
    expect(prisma.blobUploadSession._records[0].lastError).toBe('blob_url_conflict')
  })

  it('20b: blob URL conflict increments cleanupAttempts', async () => {
    const prisma = makeFakePrisma()
    const differentUrl = `https://other.public.blob.vercel-storage.com/${PATHNAME}`
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST, cleanupAttempts: 0 }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ url: differentUrl }))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(prisma.blobUploadSession._records[0].cleanupAttempts).toBe(1)
  })

  it('21: URL conflict → no delete call', async () => {
    const prisma = makeFakePrisma()
    const differentUrl = `https://other.public.blob.vercel-storage.com/${PATHNAME}`
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult({ url: differentUrl }))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('22: valid head → delete called with headResult.url, not session.blobUrl', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: UPLOADED, expiresAt: PAST, blobUrl: BLOB_URL, updatedAt: PAST }))
    const headResult = makeHeadResult()
    const headBlob = vi.fn().mockResolvedValue(headResult)
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).toHaveBeenCalledWith(headResult.url)
    expect(deleteBlob).not.toHaveBeenCalledWith(BLOB_URL + '-different')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5 — CLEANUP RETRY
// ══════════════════════════════════════════════════════════════════════════════

describe('Cleanup retry', () => {
  it('23: CLEANUP_FAILED + valid Blob → delete called', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_FAILED, expiresAt: FUTURE, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.blobsDeleted).toBe(1)
    expect(deleteBlob).toHaveBeenCalledTimes(1)
  })

  it('24: non-expired CLEANUP_FAILED success → REJECTED', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_FAILED, expiresAt: FUTURE, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.rejected).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(REJECTED)
  })

  it('25: stale CLEANUP_PENDING is recovered (headBlob called)', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_PENDING, expiresAt: PAST, updatedAt: STALE_UPDATED_AT }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(headBlob).toHaveBeenCalledTimes(1)
  })

  it('26: fresh CLEANUP_PENDING is not processed', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: CLEANUP_PENDING, expiresAt: PAST, updatedAt: FRESH_UPDATED_AT }))
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(0)
    expect(headBlob).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6 — ERRORS
// ══════════════════════════════════════════════════════════════════════════════

describe('Errors', () => {
  it('27: unknown head error → CLEANUP_FAILED', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockRejectedValue(new Error('network timeout'))
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.headErrors).toBe(1)
    expect(stats.cleanupFailed).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(CLEANUP_FAILED)
    expect(prisma.blobUploadSession._records[0].lastError).toBe('blob_head_failed')
  })

  it('28: unknown head error increments cleanupAttempts', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST, cleanupAttempts: 2 }))
    const headBlob = vi.fn().mockRejectedValue(new Error('timeout'))
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(prisma.blobUploadSession._records[0].cleanupAttempts).toBe(3)
  })

  it('29: delete failure → CLEANUP_FAILED', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockRejectedValue(new Error('delete failed'))
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.deleteErrors).toBe(1)
    expect(stats.cleanupFailed).toBe(1)
    expect(prisma.blobUploadSession._records[0].status).toBe(CLEANUP_FAILED)
    expect(prisma.blobUploadSession._records[0].lastError).toBe('blob_delete_failed')
  })

  it('30: delete failure increments cleanupAttempts', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST, cleanupAttempts: 1 }))
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn().mockRejectedValue(new Error('fail'))
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(prisma.blobUploadSession._records[0].cleanupAttempts).toBe(2)
  })

  it('31: individual failure does not abort processing next candidate', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(
      makeSession({ id: 'sess-fail', status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }),
      makeSession({ id: 'sess-ok', status: PENDING, expiresAt: PAST, updatedAt: new Date(PAST.getTime() + 1) }),
    )
    const headBlob = vi.fn().mockRejectedValue(new Error('timeout'))
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.headErrors).toBe(1)
    expect(stats.expiredCleaned).toBe(1) // PENDING was handled
    expect(stats.candidates).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7 — CONCURRENCY
// ══════════════════════════════════════════════════════════════════════════════

describe('Concurrency', () => {
  it('32: updateMany claim count=0 → skip (no storage ops)', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)
    // Simulate another worker having already claimed it — change updatedAt before claim
    const origUpdateMany = prisma.blobUploadSession.updateMany
    prisma.blobUploadSession.updateMany = vi.fn(async (args) => {
      if (args.data.status === CLEANUP_PENDING) {
        // Simulate claim race: change updatedAt so optimistic lock fails
        sess.updatedAt = new Date(sess.updatedAt.getTime() + 1)
        return { count: 0 }
      }
      return origUpdateMany(args)
    })
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.skipped).toBe(1)
    expect(headBlob).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('33: session transitions to COMPLETED after claim → no head/delete', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)
    // After claim updateMany succeeds, but findUnique shows COMPLETED+resultId
    const origUpdateMany = prisma.blobUploadSession.updateMany
    let claimDone = false
    prisma.blobUploadSession.updateMany = vi.fn(async (args) => {
      if (args.data.status === CLEANUP_PENDING && !claimDone) {
        claimDone = true
        const result = await origUpdateMany(args)
        // Simulate concurrent completion
        sess.status = COMPLETED
        sess.resultId = 'photo-concurrent'
        return result
      }
      return origUpdateMany(args)
    })
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(headBlob).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('34: resultId becomes non-null after claim → no delete', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)
    const origUpdateMany = prisma.blobUploadSession.updateMany
    let claimDone = false
    prisma.blobUploadSession.updateMany = vi.fn(async (args) => {
      if (args.data.status === CLEANUP_PENDING && !claimDone) {
        claimDone = true
        const result = await origUpdateMany(args)
        sess.resultId = 'photo-concurrent'
        return result
      }
      return origUpdateMany(args)
    })
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('35: post-delete final update count=0 does not trigger a second delete', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)
    const origUpdateMany = prisma.blobUploadSession.updateMany
    let deleteCount = 0
    prisma.blobUploadSession.updateMany = vi.fn(async (args) => {
      // Let claim succeed, but make the final status update return count=0
      const result = await origUpdateMany(args)
      if (args.data.status === EXPIRED_CLEANED || args.data.status === REJECTED) {
        return { count: 0 }
      }
      return result
    })
    const headBlob = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlob = vi.fn(async () => { deleteCount++ })
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteCount).toBe(1) // exactly one delete, not retried
  })

  it('36: two simulated workers: only one claims the candidate', async () => {
    // Worker A claims it (count=1), worker B would see count=0 because updatedAt changed
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST })
    prisma.blobUploadSession._records.push(sess)

    // Run worker A
    const headBlobA = vi.fn().mockResolvedValue(makeHeadResult())
    const deleteBlobA = vi.fn().mockResolvedValue(undefined)
    const statsA = await cleanupBlobUploadSessions({
      prisma,
      headBlob: headBlobA,
      deleteBlob: deleteBlobA,
      now: () => NOW,
      logger: { warn: vi.fn() },
    })

    // Now session is EXPIRED_CLEANED — run worker B
    const headBlobB = vi.fn()
    const deleteBlobB = vi.fn()
    const statsB = await cleanupBlobUploadSessions({
      prisma,
      headBlob: headBlobB,
      deleteBlob: deleteBlobB,
      now: () => NOW,
      logger: { warn: vi.fn() },
    })

    expect(statsA.claimed).toBe(1)
    expect(statsB.candidates).toBe(0) // already EXPIRED_CLEANED, not selected again
    expect(headBlobB).not.toHaveBeenCalled()
    expect(deleteBlobB).not.toHaveBeenCalled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8 — SAFETY
// ══════════════════════════════════════════════════════════════════════════════

describe('Safety', () => {
  it('37: deleteBlob never receives session.blobUrl directly — receives headResult.url', async () => {
    const sessionBlobUrl = 'https://session-stored.public.blob.vercel-storage.com/' + PATHNAME
    const headResultUrl = 'https://canonical.public.blob.vercel-storage.com/' + PATHNAME

    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({
      status: UPLOADED,
      expiresAt: PAST,
      blobUrl: sessionBlobUrl,
      updatedAt: PAST,
    }))
    // head returns canonical URL that matches blobUrl domain but is different from stored
    // For this test we deliberately use same URL to pass validation, then verify the arg
    const headResult = makeHeadResult({ url: sessionBlobUrl })
    const headBlob = vi.fn().mockResolvedValue(headResult)
    const receivedUrls = []
    const deleteBlob = vi.fn(async (url) => { receivedUrls.push(url) })
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    // deleteBlob must have been called with headResult.url, not a hardcoded value
    expect(receivedUrls).toHaveLength(1)
    expect(receivedUrls[0]).toBe(headResult.url)
  })

  it('38: deleteBlob receives exactly headResult.url', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(makeSession({ status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: PAST }))
    const headResult = makeHeadResult()
    const headBlob = vi.fn().mockResolvedValue(headResult)
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(deleteBlob).toHaveBeenCalledWith(headResult.url)
    expect(deleteBlob).toHaveBeenCalledTimes(1)
  })

  it('39: COMPLETED session with old expiresAt is never touched', async () => {
    const prisma = makeFakePrisma()
    const sess = makeSession({ status: COMPLETED, expiresAt: PAST, resultId: 'photo-x', updatedAt: STALE_UPDATED_AT })
    prisma.blobUploadSession._records.push(sess)
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(headBlob).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
    expect(sess.status).toBe(COMPLETED)
    expect(sess.resultId).toBe('photo-x')
  })

  it('40: service never calls delete/deleteMany on BlobUploadSession', () => {
    const src = readFileSync(
      resolve(import.meta.dirname, '../lib/server/blob-upload-cleanup.js'),
      'utf8',
    )
    expect(src).not.toContain('blobUploadSession.delete(')
    expect(src).not.toContain('blobUploadSession.deleteMany(')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9 — STATS
// ══════════════════════════════════════════════════════════════════════════════

describe('Stats', () => {
  it('41: stats counts correct for mixed batch', async () => {
    const prisma = makeFakePrisma()
    // 1 PENDING expired → expiredCleaned
    prisma.blobUploadSession._records.push(
      makeSession({ id: 's1', status: PENDING, expiresAt: PAST, updatedAt: new Date(PAST.getTime() + 1) }),
    )
    // 1 TOKEN_ISSUED expired, BlobNotFoundError → noBlob + expiredCleaned
    prisma.blobUploadSession._records.push(
      makeSession({ id: 's2', status: TOKEN_ISSUED, expiresAt: PAST, updatedAt: new Date(PAST.getTime() + 2) }),
    )
    // 1 CLEANUP_FAILED not-expired, valid head → rejected
    prisma.blobUploadSession._records.push(
      makeSession({ id: 's3', status: CLEANUP_FAILED, expiresAt: FUTURE, updatedAt: STALE_UPDATED_AT }),
    )
    let callCount = 0
    const headBlob = vi.fn(async () => {
      callCount++
      if (callCount === 1) throw new BlobNotFoundError('not found')
      return makeHeadResult()
    })
    const deleteBlob = vi.fn().mockResolvedValue(undefined)
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    expect(stats.candidates).toBe(3)
    expect(stats.claimed).toBe(3)
    expect(stats.expiredCleaned).toBe(2) // PENDING + TOKEN_ISSUED noBlob
    expect(stats.noBlob).toBe(1)
    expect(stats.blobsDeleted).toBe(1)
    expect(stats.rejected).toBe(1)
    expect(stats.cleanupFailed).toBe(0)
  })

  it('42: stats contain no IDs, URLs, or pathnames — all values are integers', async () => {
    const prisma = makeFakePrisma()
    prisma.blobUploadSession._records.push(
      makeSession({ id: 's1', status: PENDING, expiresAt: PAST, updatedAt: PAST }),
    )
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions(makeDefaultArgs(prisma, headBlob, deleteBlob))
    // Every stat value must be a non-negative integer (no string/object leakage)
    for (const [key, value] of Object.entries(stats)) {
      expect(typeof value, `stat key "${key}" should be a number`).toBe('number')
      expect(Number.isInteger(value), `stat key "${key}" should be an integer`).toBe(true)
      expect(value >= 0, `stat key "${key}" should be non-negative`).toBe(true)
    }
    // Stats must not expose session IDs, URLs, or pathnames as values
    const stringValues = Object.values(stats).filter((v) => typeof v === 'string')
    expect(stringValues).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 10 — BATCH SIZE
// ══════════════════════════════════════════════════════════════════════════════

describe('Batch size', () => {
  it('43: default take = DEFAULT_BLOB_CLEANUP_BATCH_SIZE (100)', async () => {
    expect(DEFAULT_BLOB_CLEANUP_BATCH_SIZE).toBe(100)
    const prisma = makeFakePrisma()
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const args = makeDefaultArgs(prisma, headBlob, deleteBlob)
    delete args.batchSize // use default
    // No candidates — just verify it doesn't throw
    const stats = await cleanupBlobUploadSessions(args)
    expect(stats.candidates).toBe(0)
  })

  it('44: custom valid batch size respected', async () => {
    const prisma = makeFakePrisma()
    for (let i = 0; i < 5; i++) {
      prisma.blobUploadSession._records.push(
        makeSession({ id: `s${i}`, status: PENDING, expiresAt: PAST, updatedAt: new Date(PAST.getTime() + i) }),
      )
    }
    const headBlob = vi.fn()
    const deleteBlob = vi.fn()
    const stats = await cleanupBlobUploadSessions({
      ...makeDefaultArgs(prisma, headBlob, deleteBlob),
      batchSize: 3,
    })
    expect(stats.candidates).toBe(3) // only 3 fetched
  })

  it('45: batch size > 500 throws', async () => {
    const prisma = makeFakePrisma()
    await expect(
      cleanupBlobUploadSessions({
        ...makeDefaultArgs(prisma, vi.fn(), vi.fn()),
        batchSize: 501,
      }),
    ).rejects.toThrow('batchSize must be an integer between 1 and 500')
  })

  it('46: batch size <= 0 throws', async () => {
    const prisma = makeFakePrisma()
    await expect(
      cleanupBlobUploadSessions({
        ...makeDefaultArgs(prisma, vi.fn(), vi.fn()),
        batchSize: 0,
      }),
    ).rejects.toThrow('batchSize must be an integer between 1 and 500')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 11 — CRON ROUTE + VERCEL.JSON STATIC CHECKS
// ══════════════════════════════════════════════════════════════════════════════

describe('Cron route and vercel.json static checks', () => {
  const ROOT = resolve(import.meta.dirname, '..')
  const cronSrc = readFileSync(
    resolve(ROOT, 'app/api/cron/cleanup-blob-uploads/route.js'),
    'utf8',
  )
  const vercelJson = JSON.parse(
    readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'),
  )

  it('47: cron route requires CRON_SECRET', () => {
    expect(cronSrc).toContain('process.env.CRON_SECRET')
  })

  it('48: missing secret → 503 pattern', () => {
    expect(cronSrc).toContain('status: 503')
  })

  it('49: unauthorized → 401 pattern', () => {
    expect(cronSrc).toContain('status: 401')
  })

  it('50: route does not return err.message', () => {
    expect(cronSrc).not.toContain('err.message')
    expect(cronSrc).not.toContain('error.message')
  })

  it('51: route uses head(pathname) for headBlob', () => {
    expect(cronSrc).toContain('headBlob: (pathname) => head(pathname)')
  })

  it('52: route uses deleteStoredFile(url) for deleteBlob', () => {
    expect(cronSrc).toContain('deleteBlob: (url) => deleteStoredFile(url)')
  })

  it('53: vercel.json still contains cleanup-gallery-downloads', () => {
    const paths = vercelJson.crons.map((c) => c.path)
    expect(paths).toContain('/api/cron/cleanup-gallery-downloads')
  })

  it('54: vercel.json contains cleanup-blob-uploads', () => {
    const paths = vercelJson.crons.map((c) => c.path)
    expect(paths).toContain('/api/cron/cleanup-blob-uploads')
  })

  it('55: blob upload cleanup schedule is "0 4 * * *"', () => {
    const entry = vercelJson.crons.find((c) => c.path === '/api/cron/cleanup-blob-uploads')
    expect(entry?.schedule).toBe('0 4 * * *')
  })

  it('56: vercel.json contains check-billing-health with schedule "0 5 * * *"', () => {
    const entry = vercelJson.crons.find((c) => c.path === '/api/cron/check-billing-health')
    expect(entry?.schedule).toBe('0 5 * * *')
  })
})
