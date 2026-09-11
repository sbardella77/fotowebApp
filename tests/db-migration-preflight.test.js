import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const preflight = require('../scripts/db-migration-preflight.cjs')
const wrapper = require('../scripts/run-migration-safe.cjs')

const PREVIEW_HOST = 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech'
const SAFE_DIRECT_URL = `postgresql://neondb_owner:synthetic-secret@${PREVIEW_HOST}/neondb?sslmode=require`

function createQuery({
  database = 'neondb',
  currentUser = 'neondb_owner',
  sessionUser = 'neondb_owner',
  currentRole = 'neondb_owner',
  currentSchema = 'public',
  schemaOwner = 'neondb_owner',
  canUsage = true,
  canCreate = true,
  ownershipRows = [
    { object_name: '_prisma_migrations', owner: 'neondb_owner', relkind: 'r' },
    { object_name: 'Photo', owner: 'neondb_owner', relkind: 'r' },
    { object_name: 'BlobUploadSession', owner: 'neondb_owner', relkind: 'r' },
    { object_name: 'Event', owner: 'neondb_owner', relkind: 'r' },
  ],
} = {}) {
  return vi.fn(async (sql) => {
    if (sql.includes('current_database()')) {
      return [{
        database,
        current_user: currentUser,
        session_user: sessionUser,
        current_role: currentRole,
        current_schema: currentSchema,
      }]
    }
    if (sql.includes('has_schema_privilege')) {
      return [{ schema_name: 'public', owner: schemaOwner, can_usage: canUsage, can_create: canCreate }]
    }
    if (sql.includes('FROM pg_class')) return ownershipRows
    throw new Error('unexpected synthetic SQL')
  })
}

describe('migration preflight identity guardrail', () => {
  it('A: expected role/environment/ownership -> PASS', async () => {
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: SAFE_DIRECT_URL,
      query: createQuery(),
    })

    expect(result.ok).toBe(true)
    expect(result.fields.actualRole).toBe('neondb_owner')
    expect(result.fields.host).toBe(PREVIEW_HOST)
  })

  it('B: runtime role in DIRECT_URL -> FAIL closed before DB query', async () => {
    const query = createQuery()
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: `postgresql://snaprooms_runtime:synthetic@${PREVIEW_HOST}/neondb`,
      query,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_URL_ROLE')
    expect(query).not.toHaveBeenCalled()
  })

  it('B2: DB reports runtime role even with expected URL identity -> FAIL', async () => {
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: SAFE_DIRECT_URL,
      query: createQuery({ currentUser: 'snaprooms_runtime' }),
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_ROLE')
  })

  it('C: wrong environment hostname -> FAIL closed before DB query', async () => {
    const query = createQuery()
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: 'postgresql://neondb_owner:synthetic@ep-wrong.example.neon.tech/neondb',
      query,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_HOST')
    expect(query).not.toHaveBeenCalled()
  })

  it('D: missing DIRECT_URL -> FAIL', async () => {
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: undefined,
      query: createQuery(),
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('MISSING_DIRECT_URL')
  })

  it('E: missing expected role policy -> FAIL', () => {
    const result = preflight.validateConnectionIdentity('preview', SAFE_DIRECT_URL, {
      preview: {
        enabled: true,
        expectedDatabase: 'neondb',
        expectedHost: PREVIEW_HOST,
        expectedRole: null,
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('INCOMPLETE_ENVIRONMENT_POLICY')
  })

  it('F: ownership mismatch -> FAIL', async () => {
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: SAFE_DIRECT_URL,
      query: createQuery({
        ownershipRows: [
          { object_name: '_prisma_migrations', owner: 'neondb_owner', relkind: 'r' },
          { object_name: 'Photo', owner: 'other_owner', relkind: 'r' },
          { object_name: 'BlobUploadSession', owner: 'neondb_owner', relkind: 'r' },
        ],
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('OWNERSHIP_MISMATCH')
    expect(result.fields.objects).toContain('Photo:other_owner')
  })

  it('Production remains fail-closed until its role/endpoint policy is proven', async () => {
    const query = createQuery()
    const result = await preflight.runPreflight({
      environment: 'production',
      directUrl: SAFE_DIRECT_URL,
      query,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('ENVIRONMENT_POLICY_BLOCKED')
    expect(query).not.toHaveBeenCalled()
  })

  it('machine output never includes the password or full URL', async () => {
    const result = await preflight.runPreflight({
      environment: 'preview',
      directUrl: SAFE_DIRECT_URL,
      query: createQuery(),
    })
    const text = preflight.machineLines(result).join('\n')

    expect(text).not.toContain('synthetic-secret')
    expect(text).not.toContain('postgresql://')
    expect(text).toContain(`HOST=${PREVIEW_HOST}`)
  })
})

describe('safe migration wrapper', () => {
  it('does not execute migration when preflight fails', async () => {
    const executeMigration = vi.fn(async () => 0)
    const output = vi.fn()
    const code = await wrapper.runSafeMigration({
      environment: 'preview',
      directUrl: `postgresql://snaprooms_runtime:synthetic@${PREVIEW_HOST}/neondb`,
      createExecutor: vi.fn(() => ({ query: createQuery(), disconnect: vi.fn() })),
      executeMigration,
      output,
    })

    expect(code).not.toBe(0)
    expect(executeMigration).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith('MIGRATION_EXECUTED=NO')
  })

  it('executes migration callback only after a successful preflight', async () => {
    const executeMigration = vi.fn(async () => 0)
    const disconnect = vi.fn(async () => {})
    const output = vi.fn()
    const code = await wrapper.runSafeMigration({
      environment: 'preview',
      directUrl: SAFE_DIRECT_URL,
      createExecutor: vi.fn(() => ({ query: createQuery(), disconnect })),
      executeMigration,
      output,
    })

    expect(code).toBe(0)
    expect(executeMigration).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledWith('MIGRATION_EXECUTION=AUTHORIZED_BY_PREFLIGHT')
  })
})
