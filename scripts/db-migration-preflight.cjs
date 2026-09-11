#!/usr/bin/env node
'use strict'

/**
 * Migration pre-flight identity guardrail.
 *
 * Usage:
 *   DIRECT_URL="..." node scripts/db-migration-preflight.cjs --env preview
 *   DIRECT_URL="..." node scripts/db-migration-preflight.cjs --env production
 *
 * Purpose: fail closed, before any `prisma migrate deploy`, unless the
 * connection about to be used for DDL is proven to be:
 *   1. the expected environment's Neon endpoint (not a different branch),
 *   2. a direct (non-pooled) connection,
 *   3. the expected owner-capable migration role,
 *   4. actually the owner of every ordinary table Prisma manages.
 *
 * This script NEVER reads DATABASE_URL and NEVER uses it for anything —
 * runtime credentials and migration credentials must stay separate (see
 * ENV_CONFIG below: DATABASE_URL is the least-privilege runtime connection,
 * DIRECT_URL is the owner/migration connection). It also never logs the
 * connection string or password — only a parsed, sanitized hostname.
 *
 * Exit code 0 = PASS. Any non-zero exit = FAIL. The caller (the wrapper in
 * scripts/run-migration-safe.sh) MUST NOT run `prisma migrate deploy` unless
 * this script exits 0.
 */

const REQUIRED_TABLES = ['_prisma_migrations', 'Photo', 'BlobUploadSession']

// Endpoint identities below were authoritatively bound to their Neon
// project/branch via Neon's own control-plane API (branch name + endpoint
// list), not inferred from filenames or git branches. Expected roles were
// confirmed against Neon's role/database-ownership metadata: `neondb_owner`
// is the only role that has ever existed on Production, and is the
// confirmed owner of `neondb` on every branch checked (Production, Preview,
// Development).
const ENV_CONFIG = {
  preview: {
    expectedDatabase: 'neondb',
    expectedHost: 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech',
    expectedRole: 'neondb_owner',
  },
  production: {
    expectedDatabase: 'neondb',
    expectedHost: 'ep-shy-glade-anyl7qsk.c-6.us-east-1.aws.neon.tech',
    expectedRole: 'neondb_owner',
  },
}

function parseArgs(argv) {
  let env = null
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--env') {
      env = argv[i + 1] || null
      i += 1
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length)
    }
  }
  return { env }
}

/** Extracts only the hostname from a Postgres connection string. Never
 * returns or logs anything else from the URL (no password, no full string). */
function safeHostname(connectionString) {
  try {
    const url = new URL(connectionString)
    return url.hostname
  } catch {
    return null
  }
}

function fail(reason, extra = {}) {
  const lines = ['MIGRATION_PREFLIGHT=FAIL', `REASON=${reason}`]
  for (const [key, value] of Object.entries(extra)) {
    lines.push(`${key}=${value}`)
  }
  return { ok: false, exitCode: 1, lines }
}

function pass(extra = {}) {
  const lines = ['MIGRATION_PREFLIGHT=PASS']
  for (const [key, value] of Object.entries(extra)) {
    lines.push(`${key}=${value}`)
  }
  return { ok: true, exitCode: 0, lines }
}

async function defaultConnect(directUrl) {
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } })
  try {
    const identityRows = await prisma.$queryRaw`
      SELECT
        current_database() AS current_database,
        current_user AS current_user,
        session_user AS session_user,
        current_role AS current_role,
        current_schema() AS current_schema
    `
    const ownershipRows = await prisma.$queryRaw`
      SELECT c.relname AS object_name, r.rolname AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `
    return { identity: identityRows[0], ownership: ownershipRows }
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

/**
 * Pure orchestration — no process.exit, no console output. `connect` is
 * injectable so this can be unit-tested without a real database.
 */
async function runPreflight({ env, directUrl, envConfig = ENV_CONFIG, connect = defaultConnect }) {
  if (!env) {
    return fail('MISSING_ENV_ARG')
  }

  const config = envConfig[env]
  if (!config) {
    return fail('UNKNOWN_ENVIRONMENT', { ENV: env })
  }

  if (!directUrl) {
    return fail('MISSING_DIRECT_URL', { ENV: env })
  }

  const hostname = safeHostname(directUrl)
  if (!hostname) {
    return fail('UNPARSEABLE_DIRECT_URL', { ENV: env })
  }

  if (hostname.includes('-pooler')) {
    return fail('DIRECT_URL_MUST_BE_NON_POOLED', { ENV: env, HOST: hostname })
  }

  if (hostname !== config.expectedHost) {
    return fail('UNEXPECTED_HOST', { ENV: env, EXPECTED_HOST: config.expectedHost, ACTUAL_HOST: hostname })
  }

  let identity
  let ownership
  try {
    const result = await connect(directUrl)
    identity = result.identity
    ownership = result.ownership
  } catch (error) {
    return fail('CONNECTION_FAILED', { ENV: env, DETAIL: error?.code || error?.name || 'Error' })
  }

  if (!identity) {
    return fail('IDENTITY_QUERY_EMPTY', { ENV: env })
  }

  if (identity.current_database !== config.expectedDatabase) {
    return fail('UNEXPECTED_DATABASE', {
      ENV: env,
      EXPECTED_DATABASE: config.expectedDatabase,
      ACTUAL_DATABASE: identity.current_database,
    })
  }

  if (identity.current_user !== config.expectedRole) {
    return fail('UNEXPECTED_ROLE', {
      ENV: env,
      EXPECTED_ROLE: config.expectedRole,
      ACTUAL_ROLE: identity.current_user,
    })
  }

  const ownershipByTable = new Map((ownership || []).map((row) => [row.object_name, row.owner]))

  for (const table of REQUIRED_TABLES) {
    if (!ownershipByTable.has(table)) {
      return fail('REQUIRED_TABLE_MISSING', { ENV: env, TABLE: table })
    }
  }

  const mismatches = (ownership || []).filter((row) => row.owner !== identity.current_user)
  if (mismatches.length > 0) {
    const first = mismatches[0]
    return fail('OWNERSHIP_MISMATCH', {
      ENV: env,
      OBJECT: first.object_name,
      OWNER: first.owner,
      EXPECTED_OWNER: identity.current_user,
      MISMATCH_COUNT: mismatches.length,
    })
  }

  return pass({
    ENV: env,
    DATABASE: identity.current_database,
    ROLE: identity.current_user,
    TABLES_CHECKED: ownership.length,
  })
}

async function main() {
  const { env } = parseArgs(process.argv.slice(2))
  const result = await runPreflight({ env, directUrl: process.env.DIRECT_URL })
  for (const line of result.lines) {
    console.log(line)
  }
  process.exit(result.exitCode)
}

if (require.main === module) {
  main()
}

module.exports = {
  ENV_CONFIG,
  REQUIRED_TABLES,
  parseArgs,
  safeHostname,
  runPreflight,
  defaultConnect,
}
