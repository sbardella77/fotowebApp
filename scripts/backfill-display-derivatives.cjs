#!/usr/bin/env node
'use strict'

/**
 * Display-v1 backfill operator — native Node bootstrap (STEP 7.15f.1-c).
 *
 * Usage:
 *   node scripts/backfill-display-derivatives.js        (dry run, read only)
 *   node scripts/backfill-display-derivatives.js \
 *     --apply --confirm-production \
 *     --expected-visible=<N> --expected-missing=<N>     (writes missing display-v1 objects)
 *
 * This file contains ZERO Prisma/Blob/ensure/Sharp/targeting logic — that
 * all lives in lib/server/display-backfill.js, the real production module,
 * reused unmodified. This bootstrap only: enforces the environment policy,
 * resolves the installed (transitive) Vite runtime, starts it in a
 * non-listening, in-process mode, imports the operator module through it,
 * and propagates the exit code.
 */

const path = require('path')
const { createRequire } = require('module')

const REPO_ROOT = path.resolve(__dirname, '..')
const ENV_LOCAL_PATH = path.join(REPO_ROOT, '.env.local')
const VITEST_CONFIG_PATH = path.join(REPO_ROOT, 'vitest.config.js')
const OPERATOR_MODULE_PATH = path.join(REPO_ROOT, 'lib', 'server', 'display-backfill.js')

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN']

/**
 * Loads <repo>/.env.local (or an injected override path, for tests) and
 * enforces the hardened env policy:
 *   - abort if a required var is already present in the calling shell
 *     (loadEnvFile never overwrites, so a stray shell value would otherwise
 *     silently redirect the operator to an unintended DB/Blob target);
 *   - abort if the env file is missing (no silent shell-only fallback);
 *   - abort if either required var is still missing/empty after loading.
 * Never prints a value, only variable names.
 */
function enforceEnvPolicy(envPath = ENV_LOCAL_PATH) {
  for (const name of REQUIRED_ENV_VARS) {
    if (process.env[name]) {
      return {
        ok: false,
        message: `${name} is already set in the calling environment; refusing to proceed (unset it before running this operator)`,
      }
    }
  }

  try {
    process.loadEnvFile(envPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ok: false, message: `${envPath} not found; this operator requires an explicit local environment file` }
    }
    return { ok: false, message: `Failed to load ${envPath}: ${(error && error.name) || 'Error'}` }
  }

  for (const name of REQUIRED_ENV_VARS) {
    if (!process.env[name]) {
      return { ok: false, message: `${name} is required but missing or empty after loading the environment file` }
    }
  }

  return { ok: true }
}

/**
 * Real Vite loader: resolves from the repository's own dependency graph
 * (transitive, via vitest) using Node's module-resolution primitives — never
 * a hardcoded node_modules path — then dynamically imports the resolved ESM
 * entry.
 */
async function defaultLoadVite() {
  const repoRequire = createRequire(path.join(REPO_ROOT, 'package.json'))
  const viteEntryPath = repoRequire.resolve('vite')
  return import(viteEntryPath)
}

/**
 * Resolves and validates the installed Vite runtime. Fails closed (never
 * throws) if Vite cannot be resolved, cannot be imported, or lacks the
 * required programmatic API. `loadVite` is injectable so the fail-closed
 * path is directly testable without disturbing the real installed Vite.
 */
async function resolveViteRuntime(loadVite = defaultLoadVite) {
  let viteModule
  try {
    viteModule = await loadVite()
  } catch {
    return { ok: false }
  }

  if (!viteModule || typeof viteModule.createServer !== 'function' || typeof viteModule.createServerModuleRunner !== 'function') {
    return { ok: false }
  }

  return { ok: true, viteModule }
}

function fail(message) {
  console.error(`[backfill] ${message}`)
  process.exitCode = 1
}

async function main() {
  const envResult = enforceEnvPolicy()
  if (!envResult.ok) {
    fail(envResult.message)
    return
  }

  const viteResult = await resolveViteRuntime()
  if (!viteResult.ok) {
    fail('Vite operator runtime unavailable')
    return
  }

  const { createServer, createServerModuleRunner } = viteResult.viteModule

  const server = await createServer({
    root: REPO_ROOT,
    configFile: VITEST_CONFIG_PATH,
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  })

  let runner
  try {
    runner = createServerModuleRunner(server.environments.ssr)
    const operatorModule = await runner.import(OPERATOR_MODULE_PATH)
    const dependencies = operatorModule.createRealDependencies()
    const result = await operatorModule.main(process.argv.slice(2), dependencies)
    process.exitCode = result && typeof result.exitCode === 'number' ? result.exitCode : 1
  } catch (error) {
    fail(`Operator failed: ${(error && error.name) || 'Error'}`)
  } finally {
    if (runner) await runner.close()
    await server.close()
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  main,
  enforceEnvPolicy,
  resolveViteRuntime,
  REPO_ROOT,
  ENV_LOCAL_PATH,
  VITEST_CONFIG_PATH,
  OPERATOR_MODULE_PATH,
  REQUIRED_ENV_VARS,
}
