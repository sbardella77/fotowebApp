import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { DisplayDerivativeStatus } from '@prisma/client'

// TASK-02 — EXIF Safe Delivery Foundation, Section S "Unit" + Section T
// "Legacy Safety Test".
//
// These are structural/source-level guarantees, not scenario re-tests —
// integration coverage for the actual PENDING→READY / PENDING→FAILED HTTP
// flows lives in tests/photo-display-generation.test.js (upload completion)
// and tests/photo-derivative-lifecycle.test.js (moderation-triggered
// regeneration). This file instead proves the invariants that must hold
// regardless of which call site or test scenario exercises them: the enum
// has exactly the required four values, the DB-level default is the
// conservative one, both Photo-creation call sites explicitly override it
// to PENDING, and the code recording status can never write READY from
// inside a caught-failure branch.

const SCHEMA_SRC = readFileSync(resolve(import.meta.dirname, '..', 'prisma/schema.prisma'), 'utf8')
const MIGRATION_SRC = readFileSync(
  resolve(import.meta.dirname, '..', 'prisma/migrations/20260910120000_add_photo_display_derivative_status/migration.sql'),
  'utf8',
)
const ROUTE_SRC = readFileSync(resolve(import.meta.dirname, '..', 'app/api/[[...path]]/route.js'), 'utf8')
const BLOB_COMPLETION_SRC = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/blob-upload-completion.js'), 'utf8')
const REPOSITORY_SRC = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/prisma-gallery-repository.js'), 'utf8')
// TASK-03 (Phase 1A): the READY/FAILED-recording try/catch itself was
// extracted out of route.js's ensurePhotoDisplayDerivative (now a thin
// delegating wrapper, unchanged in behavior, shared by every existing
// call site) and into this dedicated module, so it can also be reused by
// the legacy backfill mechanism. The structural invariant below now
// lives here instead of in route.js.
const STATUS_MODULE_SRC = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/photo-display-derivative-status.js'), 'utf8')

describe('DisplayDerivativeStatus enum semantics', () => {
  it('has exactly the four required values, nothing more or fewer', () => {
    expect(Object.keys(DisplayDerivativeStatus).sort()).toEqual(
      ['FAILED', 'LEGACY_UNVERIFIED', 'PENDING', 'READY'].sort(),
    )
  })

  it('each enum member is its own string value (Prisma enum convention)', () => {
    expect(DisplayDerivativeStatus.LEGACY_UNVERIFIED).toBe('LEGACY_UNVERIFIED')
    expect(DisplayDerivativeStatus.PENDING).toBe('PENDING')
    expect(DisplayDerivativeStatus.READY).toBe('READY')
    expect(DisplayDerivativeStatus.FAILED).toBe('FAILED')
  })
})

describe('schema default is the conservative value, not READY', () => {
  it('Photo.displayDerivativeStatus defaults to LEGACY_UNVERIFIED in schema.prisma', () => {
    const match = /displayDerivativeStatus\s+DisplayDerivativeStatus\s+@default\((\w+)\)/.exec(SCHEMA_SRC)
    expect(match).not.toBeNull()
    expect(match[1]).toBe('LEGACY_UNVERIFIED')
  })
})

describe('migration safety (Section F / Section T — DPO exit criterion)', () => {
  it('the migration sets the column DEFAULT to LEGACY_UNVERIFIED', () => {
    expect(MIGRATION_SRC).toMatch(/DEFAULT\s+'LEGACY_UNVERIFIED'/)
  })

  it('the migration contains no UPDATE statement — it cannot be setting any existing row to any other status', () => {
    expect(MIGRATION_SRC.toUpperCase()).not.toMatch(/\bUPDATE\b/)
  })

  it('the migration never mentions READY, PENDING, or FAILED — only the enum type declaration and the LEGACY_UNVERIFIED default touch status values', () => {
    // The enum type declaration necessarily lists all four values once; a
    // second occurrence of READY/PENDING/FAILED anywhere else in the file
    // would mean some row-level statement is touching them.
    const readyCount = (MIGRATION_SRC.match(/'READY'/g) || []).length
    const pendingCount = (MIGRATION_SRC.match(/'PENDING'/g) || []).length
    const failedCount = (MIGRATION_SRC.match(/'FAILED'/g) || []).length
    expect(readyCount).toBe(1) // inside the CREATE TYPE ... AS ENUM list only
    expect(pendingCount).toBe(1)
    expect(failedCount).toBe(1)
  })

  it('the migration is purely additive: no DROP, no ALTER ... DROP COLUMN, no TRUNCATE, no DELETE', () => {
    const upper = MIGRATION_SRC.toUpperCase()
    expect(upper).not.toMatch(/DROP\s+(TABLE|COLUMN)/)
    expect(upper).not.toMatch(/TRUNCATE/)
    expect(upper).not.toMatch(/\bDELETE\s+FROM\b/)
  })
})

describe('both Photo-creation call sites explicitly set PENDING for genuinely new uploads', () => {
  it('lib/server/blob-upload-completion.js sets displayDerivativeStatus: \'PENDING\' in its tx.photo.create call', () => {
    const match = /tx\.photo\.create\(\{[\s\S]*?\n\s*\}\)/.exec(BLOB_COMPLETION_SRC)
    expect(match).not.toBeNull()
    expect(match[0]).toMatch(/displayDerivativeStatus:\s*'PENDING'/)
  })

  it('lib/server/prisma-gallery-repository.js#createPhoto sets displayDerivativeStatus: \'PENDING\' in its prisma.photo.create call', () => {
    const match = /async createPhoto\([\s\S]*?prisma\.photo\.create\(\{[\s\S]*?\n\s*\}\)/.exec(REPOSITORY_SRC)
    expect(match).not.toBeNull()
    expect(match[0]).toMatch(/displayDerivativeStatus:\s*'PENDING'/)
  })
})

describe('route.js ensurePhotoDisplayDerivative is a thin delegating wrapper (TASK-03 Phase 1A)', () => {
  it('contains no try/catch of its own — the invariant below is enforced at its one delegate instead', () => {
    const fn = /async function ensurePhotoDisplayDerivative[\s\S]*?\n}\n/.exec(ROUTE_SRC)
    expect(fn).not.toBeNull()
    expect(fn[0]).not.toMatch(/\btry\s*\{/)
    expect(fn[0]).toMatch(/ensurePhotoDisplayDerivativeStatus\(/)
  })
})

describe('fail-closed invariant: the catch branch can only ever write FAILED, the success branch can only ever write READY', () => {
  it('ensurePhotoDisplayDerivativeStatus source: the try/success branch writes READY and never FAILED', () => {
    const fn = /export async function ensurePhotoDisplayDerivativeStatus[\s\S]*?\n\}\n/.exec(STATUS_MODULE_SRC)
    expect(fn).not.toBeNull()

    const src = fn[0]
    const tryStart = src.indexOf('try {')
    const catchStart = src.indexOf('} catch (error) {')
    expect(tryStart).toBeGreaterThan(-1)
    expect(catchStart).toBeGreaterThan(tryStart)

    const trySlice = src.slice(tryStart, catchStart)
    const catchSlice = src.slice(catchStart)

    // The success path (before the catch) may only ever record READY.
    expect(trySlice).toMatch(/displayDerivativeStatus:\s*'READY'/)
    expect(trySlice).not.toMatch(/displayDerivativeStatus:\s*'FAILED'/)

    // The failure path (the catch block) may only ever record FAILED.
    expect(catchSlice).toMatch(/displayDerivativeStatus:\s*'FAILED'/)
    expect(catchSlice).not.toMatch(/displayDerivativeStatus:\s*'READY'/)
  })

  it('no source file writes displayDerivativeStatus: \'READY\' unconditionally at Photo-creation time (only PENDING/the schema default apply there)', () => {
    expect(BLOB_COMPLETION_SRC).not.toMatch(/displayDerivativeStatus:\s*'READY'/)
    expect(REPOSITORY_SRC).not.toMatch(/displayDerivativeStatus:\s*'READY'/)
  })
})
