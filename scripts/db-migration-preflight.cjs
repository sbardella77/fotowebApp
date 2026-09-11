'use strict'

const { URL } = require('node:url')

const CRITICAL_OBJECTS = Object.freeze([
  '_prisma_migrations',
  'Photo',
  'BlobUploadSession',
])

// Production intentionally remains blocked until its direct endpoint and
// migration/owner role are established by a separate read-only evidence gate.
const ENVIRONMENT_POLICIES = Object.freeze({
  preview: Object.freeze({
    enabled: true,
    expectedDatabase: 'neondb',
    expectedHost: 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech',
    expectedRole: 'neondb_owner',
  }),
  production: Object.freeze({
    enabled: false,
    reason: 'PRODUCTION_MIGRATION_IDENTITY_NOT_VERIFIED',
    expectedDatabase: null,
    expectedHost: null,
    expectedRole: null,
  }),
})

const IDENTITY_SQL = `
SELECT
  current_database()::text AS database,
  current_user::text AS current_user,
  session_user::text AS session_user,
  current_role::text AS current_role,
  current_schema()::text AS current_schema
`

const SCHEMA_SQL = `
SELECT
  n.nspname::text AS schema_name,
  r.rolname::text AS owner,
  has_schema_privilege(current_user, n.oid, 'USAGE') AS can_usage,
  has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create
FROM pg_namespace n
JOIN pg_roles r ON r.oid = n.nspowner
WHERE n.nspname = 'public'
`

const OWNERSHIP_SQL = `
SELECT
  c.relname::text AS object_name,
  r.rolname::text AS owner,
  c.relkind::text AS relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname
`

function parseArgs(argv) {
  const args = { environment: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--env') {
      args.environment = argv[index + 1] || null
      index += 1
    }
  }
  return args
}

function fail(reason, fields = {}) {
  return { ok: false, reason, fields }
}

function pass(fields = {}) {
  return { ok: true, reason: null, fields }
}

function parseDirectUrl(value) {
  if (!value) return fail('MISSING_DIRECT_URL')

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return fail('INVALID_DIRECT_URL')
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return fail('INVALID_DIRECT_URL_PROTOCOL')
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const username = decodeURIComponent(parsed.username || '')

  if (!parsed.hostname || !database || !username) {
    return fail('INCOMPLETE_DIRECT_URL_IDENTITY')
  }

  return pass({
    host: parsed.hostname.toLowerCase(),
    database,
    username,
    port: parsed.port || '5432',
  })
}

function validateConnectionIdentity(environment, directUrl, policies = ENVIRONMENT_POLICIES) {
  if (!environment) return fail('MISSING_ENVIRONMENT_ARGUMENT')

  const policy = policies[environment]
  if (!policy) return fail('UNKNOWN_ENVIRONMENT', { environment })
  if (!policy.enabled) {
    return fail('ENVIRONMENT_POLICY_BLOCKED', {
      environment,
      policyReason: policy.reason || 'UNCONFIGURED',
    })
  }
  if (!policy.expectedDatabase || !policy.expectedHost || !policy.expectedRole) {
    return fail('INCOMPLETE_ENVIRONMENT_POLICY', { environment })
  }

  const parsed = parseDirectUrl(directUrl)
  if (!parsed.ok) return parsed

  if (parsed.fields.host !== policy.expectedHost.toLowerCase()) {
    return fail('UNEXPECTED_HOST', {
      environment,
      expectedHost: policy.expectedHost,
      actualHost: parsed.fields.host,
    })
  }

  if (parsed.fields.database !== policy.expectedDatabase) {
    return fail('UNEXPECTED_DATABASE', {
      environment,
      expectedDatabase: policy.expectedDatabase,
      actualDatabase: parsed.fields.database,
    })
  }

  if (parsed.fields.username !== policy.expectedRole) {
    return fail('UNEXPECTED_URL_ROLE', {
      environment,
      expectedRole: policy.expectedRole,
      actualRole: parsed.fields.username,
    })
  }

  return pass({ environment, policy, ...parsed.fields })
}

async function runPreflight({
  environment,
  directUrl,
  query,
  policies = ENVIRONMENT_POLICIES,
}) {
  const connection = validateConnectionIdentity(environment, directUrl, policies)
  if (!connection.ok) return connection

  if (typeof query !== 'function') return fail('QUERY_EXECUTOR_REQUIRED')

  let identityRows
  let schemaRows
  let ownershipRows
  try {
    identityRows = await query(IDENTITY_SQL)
    schemaRows = await query(SCHEMA_SQL)
    ownershipRows = await query(OWNERSHIP_SQL)
  } catch (error) {
    const safeCode = typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(error.code)
      ? error.code
      : 'UNKNOWN'
    return fail('READ_ONLY_QUERY_FAILED', { errorCode: safeCode })
  }

  const identity = identityRows?.[0]
  if (!identity) return fail('DATABASE_IDENTITY_UNAVAILABLE')

  const policy = connection.fields.policy
  if (identity.database !== policy.expectedDatabase) {
    return fail('DATABASE_IDENTITY_MISMATCH', {
      expectedDatabase: policy.expectedDatabase,
      actualDatabase: identity.database || 'UNKNOWN',
    })
  }

  if (identity.current_user !== policy.expectedRole) {
    return fail('UNEXPECTED_ROLE', {
      expectedRole: policy.expectedRole,
      actualRole: identity.current_user || 'UNKNOWN',
    })
  }

  if (identity.session_user !== policy.expectedRole || identity.current_role !== policy.expectedRole) {
    return fail('SESSION_ROLE_MISMATCH', {
      expectedRole: policy.expectedRole,
      sessionUser: identity.session_user || 'UNKNOWN',
      currentRole: identity.current_role || 'UNKNOWN',
    })
  }

  if (identity.current_schema !== 'public') {
    return fail('UNEXPECTED_CURRENT_SCHEMA', {
      expectedSchema: 'public',
      actualSchema: identity.current_schema || 'UNKNOWN',
    })
  }

  const publicSchema = schemaRows?.find((row) => row.schema_name === 'public')
  if (!publicSchema) return fail('PUBLIC_SCHEMA_NOT_FOUND')
  if (publicSchema.can_usage !== true || publicSchema.can_create !== true) {
    return fail('PUBLIC_SCHEMA_DDL_INCOMPATIBLE', {
      schemaOwner: publicSchema.owner || 'UNKNOWN',
      canUsage: String(publicSchema.can_usage === true),
      canCreate: String(publicSchema.can_create === true),
    })
  }

  const byName = new Map((ownershipRows || []).map((row) => [row.object_name, row]))
  const missingCritical = CRITICAL_OBJECTS.filter((name) => !byName.has(name))
  if (missingCritical.length > 0) {
    return fail('MISSING_CRITICAL_OBJECT', {
      objects: missingCritical.join(','),
    })
  }

  // Fail closed for every existing ordinary/partitioned table in public.
  // This is stricter than checking only the three critical objects and avoids
  // allowing a future migration to reach a table owned by another role.
  const ownershipMismatches = (ownershipRows || [])
    .filter((row) => row.owner !== policy.expectedRole)
    .map((row) => `${row.object_name}:${row.owner}`)

  if (ownershipMismatches.length > 0) {
    return fail('OWNERSHIP_MISMATCH', {
      objects: ownershipMismatches.join(','),
    })
  }

  return pass({
    environment,
    host: connection.fields.host,
    database: identity.database,
    expectedRole: policy.expectedRole,
    actualRole: identity.current_user,
    schemaOwner: publicSchema.owner,
    checkedTableCount: String((ownershipRows || []).length),
  })
}

function machineLines(result) {
  const lines = [`MIGRATION_PREFLIGHT=${result.ok ? 'PASS' : 'FAIL'}`]
  if (!result.ok) lines.push(`REASON=${result.reason}`)

  const order = [
    'environment',
    'host',
    'database',
    'expectedHost',
    'actualHost',
    'expectedDatabase',
    'actualDatabase',
    'expectedRole',
    'actualRole',
    'sessionUser',
    'currentRole',
    'expectedSchema',
    'actualSchema',
    'schemaOwner',
    'canUsage',
    'canCreate',
    'objects',
    'checkedTableCount',
    'policyReason',
    'errorCode',
  ]

  for (const key of order) {
    if (result.fields?.[key] !== undefined && result.fields[key] !== null) {
      lines.push(`${key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}=${String(result.fields[key])}`)
    }
  }
  return lines
}

function createPrismaExecutor(directUrl) {
  // Lazy require prevents unit tests from initializing Prisma or touching a DB.
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient({
    datasources: {
      db: { url: directUrl },
    },
  })

  return {
    query(sql) {
      return prisma.$queryRawUnsafe(sql)
    },
    disconnect() {
      return prisma.$disconnect()
    },
  }
}

async function main(argv = process.argv.slice(2), environmentVariables = process.env) {
  const { environment } = parseArgs(argv)
  const directUrl = environmentVariables.DIRECT_URL

  const connectionCheck = validateConnectionIdentity(environment, directUrl)
  if (!connectionCheck.ok) {
    for (const line of machineLines(connectionCheck)) console.log(line)
    return 2
  }

  let executor
  try {
    executor = createPrismaExecutor(directUrl)
    const result = await runPreflight({
      environment,
      directUrl,
      query: executor.query.bind(executor),
    })
    for (const line of machineLines(result)) console.log(line)
    return result.ok ? 0 : 3
  } catch {
    // Deliberately do not serialize the error: provider/Prisma errors can
    // contain connection details. The operator gets a safe classification.
    const result = fail('PREFLIGHT_INTERNAL_FAILURE')
    for (const line of machineLines(result)) console.log(line)
    return 4
  } finally {
    if (executor) {
      try {
        await executor.disconnect()
      } catch {
        // Never make disconnect diagnostics a secret-bearing output path.
      }
    }
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  CRITICAL_OBJECTS,
  ENVIRONMENT_POLICIES,
  IDENTITY_SQL,
  SCHEMA_SQL,
  OWNERSHIP_SQL,
  parseArgs,
  parseDirectUrl,
  validateConnectionIdentity,
  runPreflight,
  machineLines,
  main,
}
