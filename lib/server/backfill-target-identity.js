/**
 * Backfill operator target-identity guard (Guest EXIF Cutover — Operator
 * Target Safety).
 *
 * lib/server/display-backfill.js writes to both a Neon database
 * (Photo.displayDerivativeStatus) and a Vercel Blob store (display-v1
 * derivative objects). Before this guard, neither the operator nor its CLI
 * bootstrap (scripts/backfill-display-derivatives.cjs) had any way to prove
 * WHICH environment's database/Blob store a given DATABASE_URL/
 * BLOB_READ_WRITE_TOKEN pair actually targeted — an operator whose
 * .env.local accidentally mixed a Preview DATABASE_URL with a Production
 * BLOB_READ_WRITE_TOKEN (or vice versa) had no automated warning before
 * --apply ran.
 *
 * Given a declared --env and the two raw credential strings, checkTargetIdentity
 * proves (or refuses to proceed) that both belong to the SAME declared
 * environment, using only non-secret, already-public identity information:
 *
 *   - the database hostname — Neon assigns a unique compute endpoint per
 *     branch/environment, and this is that environment's most
 *     authoritative external identity signal, since Neon branch names are
 *     not themselves SQL-queryable (see databaseBranchEndpoint below);
 *   - the database name and role, confirmed LIVE via a single read-only
 *     `SELECT current_database(), current_user` against the exact
 *     connection about to be used for the real backfill writes (the
 *     injected `queryLiveDatabaseIdentity` reuses the same cached
 *     getPrismaClient() singleton the backfill itself uses — zero separate
 *     connection, zero TOCTOU gap between check and use);
 *   - the Blob store id, embedded verbatim inside BLOB_READ_WRITE_TOKEN
 *     itself. This is not a fragile guess: the installed @vercel/blob SDK
 *     derives its own effective store target from a token the exact same
 *     way (see node_modules/@vercel/blob/dist/chunk-*.js's own
 *     parseStoreIdFromReadWriteToken, `token.split('_')[3]`) — every real
 *     request this token makes is already routed by that same parse, so
 *     checking it costs zero network calls and is exactly as authoritative
 *     as the vendor SDK's own routing.
 *
 * Never logs a credential, a token, or a full connection string — only the
 * parsed hostname, database name, role, and store id, none of which are
 * secrets (all four routinely appear in plain sight: in blob URLs, in
 * `psql` prompts, in Vercel/Neon dashboards).
 *
 * ENV_CONFIG's Neon hostnames and database name are the SAME authoritative
 * values already verified for scripts/db-migration-preflight.cjs (per that
 * file's own comment: "authoritatively bound to their Neon project/branch
 * via Neon's own control-plane API"). They are duplicated here rather than
 * imported, because db-migration-preflight.cjs is a CommonJS script never
 * meant to be imported by app runtime/ESM code — tests/backfill-target-identity.test.js
 * instead asserts, by reading both files' source text, that the two
 * hostname tables can never silently drift apart.
 *
 * expectedDatabaseRole and expectedBlobStoreId are now populated with
 * operator-reported values (2026-09-13). expectedDatabaseRole is used
 * verbatim as reported — I have no independent way to query Neon's role
 * catalog myself, but a wrong role name here is safe-direction: the
 * hostname check above already runs first and is independently derived
 * from this repo's own pre-existing, real ENV_CONFIG
 * (scripts/db-migration-preflight.cjs), so a role-name error cannot by
 * itself cause a cross-environment false PASS — at worst it makes the
 * guard fail closed for a legitimate connection, exactly like the
 * NOT_CONFIGURED sentinel it replaces.
 *
 * expectedBlobStoreId is NOT verbatim what was reported
 * (`store_ktMLxVXM7JB0Ry8a` / `store_NaLsKNg8Tnw8CDe3`) — the leading
 * `store_` was stripped. Evidence, verified directly in this session
 * against the actual installed dependency, not inferred from memory:
 *
 *   node_modules/@vercel/blob/dist/chunk-*.js:
 *     function parseStoreIdFromReadWriteToken(token) {
 *       const [, , , storeId = ""] = token.split("_");
 *       return storeId;
 *     }
 *
 * This naive 4-way split only ever produces a correct result if the
 * token's storeId segment contains no underscore of its own — and this
 * exact function is what the SDK uses internally, TODAY, for every real
 * Blob call this app already makes successfully. A segment shaped like
 * "store" + "_" + "<hash>" (itself containing an underscore) would make
 * this split return only the literal word before that inner underscore,
 * not the full prefixed string — verified empirically in this session
 * against exactly that shape (see
 * tests/backfill-target-identity.test.js's "store-id prefix
 * normalization" tests for the executable form of this same check; no
 * example token is written out here so this file itself never contains a
 * credential-shaped string, per the test below that guards against that).
 * Since the SDK's real, live-traffic-serving parse could not work at all
 * if the true embedded segment carried the `store_` prefix, the `store_`
 * form reported here is almost certainly the Vercel-dashboard
 * human-readable display convention (mirroring `normalizeStoreId()`
 * elsewhere in the same SDK, which exists specifically to strip this
 * exact prefix from a DIFFERENT storeId source — a delegation-token
 * payload). The prefix-stripped values below are what
 * parseStoreIdFromReadWriteToken will actually produce from the real
 * BLOB_READ_WRITE_TOKEN at runtime, by this reasoning.
 *
 * This is not "deriving expected identity dynamically from the live
 * credential" (never done — these remain a static, hardcoded table) — it
 * is transcribing an operator-reported dashboard value into the format
 * this module's own already-reviewed parser actually expects, exactly
 * the same normalization the vendor SDK itself performs for its other
 * storeId input path. Flagged here, not silently applied: a wrong guess
 * here is still safe-direction (permanent fail-closed, never a false
 * PASS — the check is exact-string equality with no fallback), but it is
 * a judgment call, not a re-typed operator value, and the operator should
 * confirm it empirically before trusting a real PASS — one line, per
 * environment, run wherever BLOB_READ_WRITE_TOKEN is actually available:
 *     node -e "console.log(process.env.BLOB_READ_WRITE_TOKEN.split('_')[3])"
 * If that ever prints something other than the values below, this table
 * is wrong and must be corrected, not the parser.
 */

export const NOT_CONFIGURED = 'NOT_CONFIGURED'

export const ENV_CONFIG = {
  preview: {
    expectedDirectHost: 'ep-bitter-base-an3r03ez.c-6.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'snaprooms_runtime',
    expectedBlobStoreId: 'ktMLxVXM7JB0Ry8a',
  },
  production: {
    expectedDirectHost: 'ep-shy-glade-anyl7qsk.c-6.us-east-1.aws.neon.tech',
    expectedDatabaseName: 'neondb',
    expectedDatabaseRole: 'snaprooms_prod_runtime',
    expectedBlobStoreId: 'NaLsKNg8Tnw8CDe3',
  },
}

/**
 * The exact parse the installed @vercel/blob SDK uses internally
 * (parseStoreIdFromReadWriteToken in its own source) to derive a request's
 * effective store target from BLOB_READ_WRITE_TOKEN. Vercel Blob RW tokens
 * have the documented shape `vercel_blob_rw_<storeId>_<random>`.
 */
export function parseStoreIdFromReadWriteToken(token) {
  if (typeof token !== 'string') return ''
  const [, , , storeId = ''] = token.split('_')
  return storeId
}

/** Only the hostname is ever extracted — never any other part of the connection string. */
export function parseDatabaseUrlHost(databaseUrl) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return null
  try {
    return new URL(databaseUrl).hostname
  } catch {
    return null
  }
}

/**
 * DATABASE_URL is always the pooled runtime connection (see
 * docs/incident-db-unavailable.md: "DATABASE_URL must point to pooled
 * connection (*.pooler.*)"); Neon's pooled hostname is the direct host's
 * endpoint segment with `-pooler` appended, with everything from the first
 * dot onward unchanged. Derived algorithmically from the already-verified
 * direct host rather than hardcoding a second, independently-drifting
 * pooled constant per environment.
 */
export function isExpectedPooledHost(actualHost, expectedDirectHost) {
  if (typeof actualHost !== 'string' || typeof expectedDirectHost !== 'string') return false
  const [actualEndpoint, ...actualRest] = actualHost.split('.')
  const [directEndpoint, ...directRest] = expectedDirectHost.split('.')
  if (actualRest.length === 0 || actualRest.join('.') !== directRest.join('.')) return false
  return actualEndpoint === `${directEndpoint}-pooler`
}

/**
 * Pure, string-only declared-identity extraction — no network calls, never
 * touches process.env (both raw credential strings are read by the caller
 * and passed in), so this stays fully unit-testable with synthetic strings.
 */
export function parseDeclaredIdentity({ databaseUrl, blobReadWriteToken }) {
  return {
    databaseHost: parseDatabaseUrlHost(databaseUrl),
    blobStoreId: parseStoreIdFromReadWriteToken(blobReadWriteToken),
  }
}

function fail(reason, extra = {}) {
  return { ok: false, reason, ...extra }
}
function pass(extra = {}) {
  return { ok: true, ...extra }
}

/**
 * The full target-identity gate. `queryLiveDatabaseIdentity` is injectable
 * (a zero-argument async function returning `{databaseName, databaseRole}`)
 * so this stays a pure orchestration, testable with fully synthetic
 * fixtures and never opening a real connection in tests.
 *
 * Runs the cheap, zero-network declared-identity checks FIRST — hostname,
 * then Blob store id — before `queryLiveDatabaseIdentity` is ever invoked,
 * so the most common operator mistake (an entirely wrong .env.local) fails
 * before any live connection is attempted at all.
 */
export async function checkTargetIdentity({ env, databaseUrl, blobReadWriteToken, queryLiveDatabaseIdentity, envConfig = ENV_CONFIG }) {
  const config = envConfig[env]
  if (!config) {
    return fail('UNKNOWN_ENVIRONMENT', { env })
  }

  const declared = parseDeclaredIdentity({ databaseUrl, blobReadWriteToken })

  if (!declared.databaseHost) {
    return fail('UNPARSEABLE_DATABASE_URL', { env })
  }
  if (!isExpectedPooledHost(declared.databaseHost, config.expectedDirectHost)) {
    return fail('UNEXPECTED_DATABASE_HOST', { env, expectedDirectHost: config.expectedDirectHost, actualHost: declared.databaseHost })
  }

  if (config.expectedBlobStoreId === NOT_CONFIGURED) {
    return fail('BLOB_STORE_ID_NOT_CONFIGURED', { env })
  }
  if (!declared.blobStoreId || declared.blobStoreId !== config.expectedBlobStoreId) {
    return fail('UNEXPECTED_BLOB_STORE', { env, expectedBlobStoreId: config.expectedBlobStoreId, actualBlobStoreId: declared.blobStoreId || '(unparseable)' })
  }

  let live
  try {
    live = await queryLiveDatabaseIdentity()
  } catch (error) {
    return fail('DATABASE_CONNECTION_FAILED', { env, detail: error?.code || error?.name || 'Error' })
  }

  if (!live || live.databaseName !== config.expectedDatabaseName) {
    return fail('UNEXPECTED_DATABASE_NAME', { env, expectedDatabaseName: config.expectedDatabaseName, actualDatabaseName: live?.databaseName || '(none)' })
  }

  if (config.expectedDatabaseRole === NOT_CONFIGURED) {
    return fail('DATABASE_ROLE_NOT_CONFIGURED', { env, actualDatabaseRole: live.databaseRole })
  }
  if (live.databaseRole !== config.expectedDatabaseRole) {
    return fail('UNEXPECTED_DATABASE_ROLE', { env, expectedDatabaseRole: config.expectedDatabaseRole, actualDatabaseRole: live.databaseRole })
  }

  return pass({
    env,
    databaseHost: declared.databaseHost,
    databaseName: live.databaseName,
    databaseRole: live.databaseRole,
    // Neon exposes no SQL-queryable branch name; the compute-endpoint id is
    // this repo's established 1:1 branch-identity proxy (see
    // scripts/db-migration-preflight.cjs's own identical convention).
    databaseBranchEndpoint: config.expectedDirectHost.split('.')[0],
    blobStoreId: declared.blobStoreId,
  })
}
