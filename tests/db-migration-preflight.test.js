import { describe, it, expect } from 'vitest'
import {
  ENV_CONFIG,
  REQUIRED_TABLES,
  parseArgs,
  safeHostname,
  runPreflight,
} from '../scripts/db-migration-preflight.cjs'

const PREVIEW_HOST = ENV_CONFIG.preview.expectedHost
const PRODUCTION_HOST = ENV_CONFIG.production.expectedHost
const PREVIEW_DIRECT_URL = `postgresql://neondb_owner:secretpass@${PREVIEW_HOST}:5432/neondb?sslmode=require`

function makeOwnershipRows(owner, tables = REQUIRED_TABLES) {
  return tables.map((name) => ({ object_name: name, owner }))
}

function makeConnect({ identity, ownership }) {
  return async () => ({ identity, ownership })
}

// TASK: Migration Pre-Flight Identity Guardrail — Step 8 required scenarios
// (A-F), plus supporting unit coverage for the pure helpers. All DB access
// is mocked via the injectable `connect` parameter — no real database is
// ever touched by this suite.

describe('A. expected role and ownership → PASS', () => {
  it('passes when host, database, role, and all required-table ownership match the preview policy', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'neondb',
        current_user: 'neondb_owner',
        session_user: 'neondb_owner',
        current_role: 'neondb_owner',
        current_schema: 'public',
      },
      ownership: makeOwnershipRows('neondb_owner'),
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.lines[0]).toBe('MIGRATION_PREFLIGHT=PASS')
    expect(result.lines.join('\n')).toContain('ROLE=neondb_owner')
  })
})

describe('B. wrong runtime role → FAIL', () => {
  it('fails closed when current_user is the least-privilege runtime role instead of the owner', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'neondb',
        current_user: 'snaprooms_runtime',
        session_user: 'snaprooms_runtime',
        current_role: 'snaprooms_runtime',
        current_schema: 'public',
      },
      ownership: makeOwnershipRows('neondb_owner'),
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    const text = result.lines.join('\n')
    expect(text).toContain('REASON=UNEXPECTED_ROLE')
    expect(text).toContain('EXPECTED_ROLE=neondb_owner')
    expect(text).toContain('ACTUAL_ROLE=snaprooms_runtime')
  })
})

describe('C. wrong environment/hostname → FAIL', () => {
  it('fails closed when DIRECT_URL points at a different branch than the requested --env', async () => {
    const wrongBranchUrl = `postgresql://neondb_owner:secretpass@${PRODUCTION_HOST}:5432/neondb?sslmode=require`
    const connect = makeConnect({ identity: null, ownership: [] })

    const result = await runPreflight({ env: 'preview', directUrl: wrongBranchUrl, connect })

    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('REASON=UNEXPECTED_HOST')
    expect(text).toContain(`EXPECTED_HOST=${PREVIEW_HOST}`)
    expect(text).toContain(`ACTUAL_HOST=${PRODUCTION_HOST}`)
  })

  it('fails closed on a completely unrecognized hostname', async () => {
    const unknownUrl = 'postgresql://someone:pass@totally-unrelated-host.example.com:5432/neondb'
    const connect = makeConnect({ identity: null, ownership: [] })

    const result = await runPreflight({ env: 'production', directUrl: unknownUrl, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=UNEXPECTED_HOST')
  })

  it('fails closed when DIRECT_URL is actually a pooled connection, even on the correct branch', async () => {
    const pooledUrl = `postgresql://neondb_owner:secretpass@${PREVIEW_HOST.replace('.c-6', '-pooler.c-6')}:5432/neondb`
    const connect = makeConnect({ identity: null, ownership: [] })

    const result = await runPreflight({ env: 'preview', directUrl: pooledUrl, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=DIRECT_URL_MUST_BE_NON_POOLED')
  })
})

describe('D. missing DIRECT_URL → FAIL', () => {
  it('fails closed when DIRECT_URL is undefined', async () => {
    const connect = makeConnect({ identity: null, ownership: [] })
    const result = await runPreflight({ env: 'preview', directUrl: undefined, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=MISSING_DIRECT_URL')
  })

  it('fails closed when DIRECT_URL is an empty string', async () => {
    const connect = makeConnect({ identity: null, ownership: [] })
    const result = await runPreflight({ env: 'preview', directUrl: '', connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=MISSING_DIRECT_URL')
  })
})

describe('E. missing expected role config → FAIL', () => {
  it('fails closed when --env is omitted entirely', async () => {
    const connect = makeConnect({ identity: null, ownership: [] })
    const result = await runPreflight({ env: null, directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=MISSING_ENV_ARG')
  })

  it('fails closed when --env names an environment with no defined policy', async () => {
    const connect = makeConnect({ identity: null, ownership: [] })
    const result = await runPreflight({ env: 'staging', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=UNKNOWN_ENVIRONMENT')
  })
})

describe('F. ownership mismatch → FAIL', () => {
  it('fails closed when any required table is owned by a different role', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'neondb',
        current_user: 'neondb_owner',
        session_user: 'neondb_owner',
        current_role: 'neondb_owner',
        current_schema: 'public',
      },
      ownership: [
        { object_name: '_prisma_migrations', owner: 'neondb_owner' },
        { object_name: 'Photo', owner: 'some_other_role' },
        { object_name: 'BlobUploadSession', owner: 'neondb_owner' },
      ],
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('REASON=OWNERSHIP_MISMATCH')
    expect(text).toContain('OBJECT=Photo')
    expect(text).toContain('OWNER=some_other_role')
  })

  it('fails closed when a required table is absent from the ownership scan entirely', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'neondb',
        current_user: 'neondb_owner',
        session_user: 'neondb_owner',
        current_role: 'neondb_owner',
        current_schema: 'public',
      },
      ownership: [
        { object_name: '_prisma_migrations', owner: 'neondb_owner' },
        { object_name: 'BlobUploadSession', owner: 'neondb_owner' },
      ],
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('REASON=REQUIRED_TABLE_MISSING')
    expect(text).toContain('TABLE=Photo')
  })
})

describe('additional safety: database mismatch and connection failure', () => {
  it('fails closed when current_database does not match the expected database', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'some_other_db',
        current_user: 'neondb_owner',
        session_user: 'neondb_owner',
        current_role: 'neondb_owner',
        current_schema: 'public',
      },
      ownership: makeOwnershipRows('neondb_owner'),
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('REASON=UNEXPECTED_DATABASE')
  })

  it('fails closed and never leaks connection details when the connection itself throws', async () => {
    const secretBearingMessage = `password authentication failed for user "neondb_owner" host=${PREVIEW_HOST} password=hunter2`
    const connect = async () => {
      throw new Error(secretBearingMessage)
    }

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    expect(result.ok).toBe(false)
    const text = result.lines.join('\n')
    expect(text).toContain('REASON=CONNECTION_FAILED')
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('password=')
  })
})

describe('secret safety: sanitized hostname parsing never surfaces credentials', () => {
  it('safeHostname returns only the hostname, never the username/password/full string', () => {
    const url = 'postgresql://neondb_owner:supersecretpassword@example.neon.tech:5432/neondb?sslmode=require'
    const host = safeHostname(url)

    expect(host).toBe('example.neon.tech')
    expect(host).not.toContain('supersecretpassword')
    expect(host).not.toContain('neondb_owner')
  })

  it('safeHostname returns null for an unparseable string instead of throwing', () => {
    expect(safeHostname('not-a-url')).toBeNull()
    expect(safeHostname('')).toBeNull()
  })

  it('runPreflight never places the raw directUrl or any password into its output lines', async () => {
    const connect = makeConnect({
      identity: {
        current_database: 'neondb',
        current_user: 'snaprooms_runtime',
        session_user: 'snaprooms_runtime',
        current_role: 'snaprooms_runtime',
        current_schema: 'public',
      },
      ownership: makeOwnershipRows('neondb_owner'),
    })

    const result = await runPreflight({ env: 'preview', directUrl: PREVIEW_DIRECT_URL, connect })

    const text = result.lines.join('\n')
    expect(text).not.toContain('secretpass')
    expect(text).not.toContain(PREVIEW_DIRECT_URL)
  })
})

describe('parseArgs', () => {
  it('parses --env <value> (space-separated) form', () => {
    expect(parseArgs(['--env', 'preview'])).toEqual({ env: 'preview' })
  })

  it('parses --env=<value> form', () => {
    expect(parseArgs(['--env=production'])).toEqual({ env: 'production' })
  })

  it('returns env=null when --env is not present', () => {
    expect(parseArgs([])).toEqual({ env: null })
  })
})

describe('ENV_CONFIG policy shape', () => {
  it('defines an owner-capable expected role, not a runtime role, for every configured environment', () => {
    for (const [name, config] of Object.entries(ENV_CONFIG)) {
      expect(config.expectedRole).toBe('neondb_owner')
      expect(config.expectedRole).not.toMatch(/runtime|_dev$/)
      expect(config.expectedHost).not.toContain('-pooler')
      expect(name).toMatch(/^(preview|production)$/)
    }
  })
})
