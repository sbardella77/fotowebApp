import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  ENV_CONFIG,
  NOT_CONFIGURED,
  parseStoreIdFromReadWriteToken,
  parseDatabaseUrlHost,
  isExpectedPooledHost,
  parseDeclaredIdentity,
  checkTargetIdentity,
} from '@/lib/server/backfill-target-identity'

// Guest EXIF Cutover — Operator Target Safety.
//
// This module is the fail-closed proof that a backfill --apply run's
// DATABASE_URL and BLOB_READ_WRITE_TOKEN both belong to the SAME declared
// --env, before lib/server/display-backfill.js is allowed to touch either.
// See the module's own doc comment for the full rationale (a Preview
// DATABASE_URL + Production BLOB_READ_WRITE_TOKEN pair had no automated
// warning before this guard existed).

const TEST_ENV_CONFIG = {
  preview: {
    expectedDirectHost: 'ep-test-preview-endpoint.c-1.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'test_runtime_role',
    expectedBlobStoreId: 'previewstoreid123',
  },
  production: {
    expectedDirectHost: 'ep-test-production-endpoint.c-1.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'test_runtime_role',
    expectedBlobStoreId: 'productionstoreid456',
  },
}

const PREVIEW_DB_URL = 'postgresql://user:pass@ep-test-preview-endpoint-pooler.c-1.us-east-1.aws.neon.tech/neondb?sslmode=require'
const PRODUCTION_DB_URL = 'postgresql://user:pass@ep-test-production-endpoint-pooler.c-1.us-east-1.aws.neon.tech/neondb?sslmode=require'
const PREVIEW_BLOB_TOKEN = 'vercel_blob_rw_previewstoreid123_randomsuffixabc'
const PRODUCTION_BLOB_TOKEN = 'vercel_blob_rw_productionstoreid456_randomsuffixdef'
const LIVE_PREVIEW = { databaseName: 'neondb', databaseRole: 'test_runtime_role' }
const LIVE_PRODUCTION = { databaseName: 'neondb', databaseRole: 'test_runtime_role' }

describe('parseStoreIdFromReadWriteToken — mirrors the installed @vercel/blob SDK\'s own parse', () => {
  it('extracts the 4th underscore-delimited segment', () => {
    expect(parseStoreIdFromReadWriteToken('vercel_blob_rw_abc123_randomsuffix')).toBe('abc123')
  })

  it('non-string input returns empty string, never throws', () => {
    expect(parseStoreIdFromReadWriteToken(undefined)).toBe('')
    expect(parseStoreIdFromReadWriteToken(null)).toBe('')
    expect(parseStoreIdFromReadWriteToken(123)).toBe('')
  })

  it('malformed token (too few segments) returns empty string', () => {
    expect(parseStoreIdFromReadWriteToken('not-a-real-token')).toBe('')
  })

  it('matches the real @vercel/blob SDK parse exactly for the same input', async () => {
    // node_modules/@vercel/blob/dist/chunk-*.js:
    //   function parseStoreIdFromReadWriteToken(token) {
    //     const [, , , storeId = ""] = token.split("_");
    //     return storeId;
    //   }
    const token = 'vercel_blob_rw_realsdkparitystore_xyz'
    const [, , , sdkEquivalent = ''] = token.split('_')
    expect(parseStoreIdFromReadWriteToken(token)).toBe(sdkEquivalent)
  })
})

describe('parseDatabaseUrlHost', () => {
  it('extracts only the hostname', () => {
    expect(parseDatabaseUrlHost('postgresql://user:pass@ep-abc-pooler.c-1.us-east-1.aws.neon.tech:5432/neondb?sslmode=require')).toBe(
      'ep-abc-pooler.c-1.us-east-1.aws.neon.tech',
    )
  })

  it('unparseable input returns null, never throws', () => {
    expect(parseDatabaseUrlHost('not a url')).toBeNull()
    expect(parseDatabaseUrlHost(undefined)).toBeNull()
    expect(parseDatabaseUrlHost('')).toBeNull()
  })
})

describe('isExpectedPooledHost', () => {
  it('true for the correct -pooler-suffixed endpoint with everything else identical', () => {
    expect(isExpectedPooledHost('ep-bitter-base-an3r03ez-pooler.c-6.us-east-1.aws.neon.tech', 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech')).toBe(true)
  })

  it('false when the endpoint segment does not match, even with -pooler present', () => {
    expect(isExpectedPooledHost('ep-shy-glade-anyl7qsk-pooler.c-6.us-east-1.aws.neon.tech', 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech')).toBe(false)
  })

  it('false when -pooler is missing entirely (a direct host is not a valid runtime DATABASE_URL host)', () => {
    expect(isExpectedPooledHost('ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech', 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech')).toBe(false)
  })

  it('false when the cluster/region/provider suffix differs', () => {
    expect(isExpectedPooledHost('ep-bitter-base-an3r03ez-pooler.c-9.eu-west-1.aws.neon.tech', 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech')).toBe(false)
  })

  it('non-string inputs return false, never throw', () => {
    expect(isExpectedPooledHost(null, 'ep-x.c-6.us-east-1.aws.neon.tech')).toBe(false)
    expect(isExpectedPooledHost('ep-x-pooler.c-6.us-east-1.aws.neon.tech', undefined)).toBe(false)
  })
})

describe('parseDeclaredIdentity', () => {
  it('combines both pure parses, no network calls, no process.env access', () => {
    const declared = parseDeclaredIdentity({ databaseUrl: PREVIEW_DB_URL, blobReadWriteToken: PREVIEW_BLOB_TOKEN })
    expect(declared).toEqual({
      databaseHost: 'ep-test-preview-endpoint-pooler.c-1.us-east-1.aws.neon.tech',
      blobStoreId: 'previewstoreid123',
    })
  })
})

describe('checkTargetIdentity — Step 8 required matrix', () => {
  it('1. Preview DB + Preview Blob + --env=preview -> PASS', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue(LIVE_PREVIEW)
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({
      env: 'preview',
      databaseName: 'neondb',
      databaseRole: 'test_runtime_role',
      blobStoreId: 'previewstoreid123',
      databaseBranchEndpoint: 'ep-test-preview-endpoint',
    })
  })

  it('2. Production DB + Production Blob + --env=production -> PASS', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue(LIVE_PRODUCTION)
    const result = await checkTargetIdentity({
      env: 'production',
      databaseUrl: PRODUCTION_DB_URL,
      blobReadWriteToken: PRODUCTION_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(true)
    expect(result.blobStoreId).toBe('productionstoreid456')
  })

  it('3. Preview DB + Production Blob -> FAIL (UNEXPECTED_BLOB_STORE), and the live DB query is never reached', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue(LIVE_PREVIEW)
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PRODUCTION_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_BLOB_STORE')
    expect(queryLiveDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('4. Production DB + Preview Blob -> FAIL (UNEXPECTED_BLOB_STORE)', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue(LIVE_PRODUCTION)
    const result = await checkTargetIdentity({
      env: 'production',
      databaseUrl: PRODUCTION_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_BLOB_STORE')
    expect(queryLiveDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('5. wrong --env (declares preview, DB is actually production) -> FAIL (UNEXPECTED_DATABASE_HOST)', async () => {
    const queryLiveDatabaseIdentity = vi.fn()
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PRODUCTION_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_DATABASE_HOST')
    expect(queryLiveDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('6. unknown/missing --env value -> FAIL (UNKNOWN_ENVIRONMENT)', async () => {
    const result = await checkTargetIdentity({
      env: null,
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity: vi.fn(),
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNKNOWN_ENVIRONMENT')
  })

  it('9. any identity failure never invokes the live database query when the declared checks already failed', async () => {
    const queryLiveDatabaseIdentity = vi.fn()
    await checkTargetIdentity({
      env: 'preview',
      databaseUrl: 'not-a-url',
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(queryLiveDatabaseIdentity).not.toHaveBeenCalled()
  })

  it('a live database name mismatch fails closed (UNEXPECTED_DATABASE_NAME) even when host/blob both matched', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue({ databaseName: 'someotherdb', databaseRole: 'test_runtime_role' })
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_DATABASE_NAME')
  })

  it('a live database role mismatch fails closed (UNEXPECTED_DATABASE_ROLE)', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue({ databaseName: 'neondb', databaseRole: 'wrong_role' })
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('UNEXPECTED_DATABASE_ROLE')
  })

  it('a failed/rejected live query fails closed (DATABASE_CONNECTION_FAILED), never throws', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockRejectedValue(new Error('connection refused'))
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('DATABASE_CONNECTION_FAILED')
  })

  it('never includes the raw databaseUrl or blobReadWriteToken in its result, pass or fail', async () => {
    const queryLiveDatabaseIdentity = vi.fn().mockResolvedValue(LIVE_PREVIEW)
    const passResult = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PREVIEW_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    const serializedPass = JSON.stringify(passResult)
    expect(serializedPass).not.toContain(PREVIEW_BLOB_TOKEN)
    expect(serializedPass).not.toContain('user:pass')

    const failResult = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: PREVIEW_DB_URL,
      blobReadWriteToken: PRODUCTION_BLOB_TOKEN,
      queryLiveDatabaseIdentity,
      envConfig: TEST_ENV_CONFIG,
    })
    const serializedFail = JSON.stringify(failResult)
    expect(serializedFail).not.toContain(PRODUCTION_BLOB_TOKEN)
    expect(serializedFail).not.toContain('user:pass')
  })
})

describe('fail-closed-by-default: the REAL, shipped ENV_CONFIG blocks both environments until a human fills in real values', () => {
  it('preview: expectedBlobStoreId and expectedDatabaseRole are NOT_CONFIGURED sentinels today', () => {
    expect(ENV_CONFIG.preview.expectedBlobStoreId).toBe(NOT_CONFIGURED)
    expect(ENV_CONFIG.preview.expectedDatabaseRole).toBe(NOT_CONFIGURED)
  })

  it('production: expectedBlobStoreId and expectedDatabaseRole are NOT_CONFIGURED sentinels today', () => {
    expect(ENV_CONFIG.production.expectedBlobStoreId).toBe(NOT_CONFIGURED)
    expect(ENV_CONFIG.production.expectedDatabaseRole).toBe(NOT_CONFIGURED)
  })

  it('a real-shaped Preview identity check against the SHIPPED ENV_CONFIG fails closed on BLOB_STORE_ID_NOT_CONFIGURED, never PASS', async () => {
    const [directEndpoint, ...directRest] = ENV_CONFIG.preview.expectedDirectHost.split('.')
    const realShapedPooledHost = [`${directEndpoint}-pooler`, ...directRest].join('.')
    const result = await checkTargetIdentity({
      env: 'preview',
      databaseUrl: `postgresql://user:pass@${realShapedPooledHost}/neondb?sslmode=require`,
      blobReadWriteToken: 'vercel_blob_rw_anything_x',
      queryLiveDatabaseIdentity: vi.fn().mockResolvedValue({ databaseName: 'neondb', databaseRole: 'whatever' }),
      // deliberately NOT passing envConfig — uses the real shipped ENV_CONFIG default
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('BLOB_STORE_ID_NOT_CONFIGURED')
  })

  it('production hostname is genuinely distinct from preview\'s (a copy-paste-both-the-same bug would be silently unsafe)', () => {
    expect(ENV_CONFIG.production.expectedDirectHost).not.toBe(ENV_CONFIG.preview.expectedDirectHost)
  })
})

describe('drift guard: ENV_CONFIG hostnames must stay identical to scripts/db-migration-preflight.cjs\'s own authoritative table', () => {
  // db-migration-preflight.cjs is CommonJS and never imported by app/ESM
  // runtime code (see this module's own doc comment for why) — the two
  // tables are necessarily duplicated, so this test is the only thing
  // stopping them from silently drifting apart if either Neon endpoint ever
  // changes and only one file gets updated.
  const migrationPreflightSrc = readFileSync(resolve(import.meta.dirname, '..', 'scripts/db-migration-preflight.cjs'), 'utf8')

  it('preview expectedDirectHost matches db-migration-preflight.cjs\'s preview.expectedHost', () => {
    const match = /preview:\s*\{[\s\S]*?expectedHost:\s*'([^']+)'/.exec(migrationPreflightSrc)
    expect(match).not.toBeNull()
    expect(ENV_CONFIG.preview.expectedDirectHost).toBe(match[1])
  })

  it('production expectedDirectHost matches db-migration-preflight.cjs\'s production.expectedHost', () => {
    const match = /production:\s*\{[\s\S]*?expectedHost:\s*'([^']+)'/.exec(migrationPreflightSrc)
    expect(match).not.toBeNull()
    expect(ENV_CONFIG.production.expectedDirectHost).toBe(match[1])
  })

  it('expectedDatabaseName matches db-migration-preflight.cjs\'s expectedDatabase for both environments', () => {
    const matches = [...migrationPreflightSrc.matchAll(/expectedDatabase:\s*'([^']+)'/g)].map((m) => m[1])
    expect(matches.length).toBe(2)
    expect(new Set(matches)).toEqual(new Set(['neondb']))
    expect(ENV_CONFIG.preview.expectedDatabaseName).toBe('neondb')
    expect(ENV_CONFIG.production.expectedDatabaseName).toBe('neondb')
  })
})

describe('no credential ever appears in this module\'s own source', () => {
  it('the source contains no literal token/password-shaped string', () => {
    const src = readFileSync(resolve(import.meta.dirname, '..', 'lib/server/backfill-target-identity.js'), 'utf8')
    expect(src).not.toMatch(/vercel_blob_rw_[a-zA-Z0-9]/)
    expect(src).not.toMatch(/postgresql:\/\//)
  })
})
