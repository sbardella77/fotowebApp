import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// TASK: Migration Pre-Flight Guardrail — Step 5, "Wrapper Execution
// Guarantee". This does NOT touch db-migration-preflight.cjs's own logic
// (covered by tests/db-migration-preflight.test.js) — it verifies the SHELL
// WRAPPER's control flow structurally: does `prisma migrate deploy` get
// invoked exactly when (and only when) the pre-flight step exits 0? Both
// `node` and `npx` are replaced with call-counting stand-ins on PATH for the
// child process only; no real database, Prisma engine, or network call is
// ever reached.

const REPO_ROOT = join(import.meta.dirname, '..')
const WRAPPER_PATH = join(REPO_ROOT, 'scripts', 'run-migration-safe.sh')

let fakeBinDir
let callLogFile

beforeEach(() => {
  fakeBinDir = mkdtempSync(join(tmpdir(), 'preflight-wrapper-fakebin-'))
  callLogFile = join(mkdtempSync(join(tmpdir(), 'preflight-wrapper-log-')), 'calls.log')

  // Fake `node`: only ever invoked by the wrapper for the pre-flight script.
  // Exits with FAKE_PREFLIGHT_EXIT_CODE, logs nothing (its role is purely to
  // control pass/fail — call evidence for the *real* work comes from `npx`).
  writeFileSync(
    join(fakeBinDir, 'node'),
    `#!/usr/bin/env bash\nexit "\${FAKE_PREFLIGHT_EXIT_CODE:-0}"\n`,
  )
  chmodSync(join(fakeBinDir, 'node'), 0o755)

  // Fake `npx`: records every invocation (used by the wrapper for both
  // `prisma migrate deploy` and `prisma migrate status`), always exits 0.
  writeFileSync(
    join(fakeBinDir, 'npx'),
    `#!/usr/bin/env bash\necho "$@" >> "$CALL_LOG_FILE"\nexit 0\n`,
  )
  chmodSync(join(fakeBinDir, 'npx'), 0o755)
})

afterEach(() => {
  rmSync(fakeBinDir, { recursive: true, force: true })
})

function runWrapper({ env, preflightExitCode }) {
  const fakePath = `${fakeBinDir}:${process.env.PATH}`
  return spawnSync('bash', [WRAPPER_PATH, '--env', env], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: fakePath,
      DIRECT_URL: 'postgresql://irrelevant:irrelevant@irrelevant.invalid:5432/db',
      FAKE_PREFLIGHT_EXIT_CODE: String(preflightExitCode),
      CALL_LOG_FILE: callLogFile,
    },
    encoding: 'utf8',
  })
}

describe('wrapper execution guarantee: preflight PASS → migrate deploy runs', () => {
  it('invokes prisma migrate deploy (via npx) exactly once when pre-flight exits 0', () => {
    const result = runWrapper({ env: 'preview', preflightExitCode: 0 })

    expect(result.status).toBe(0)
    const calls = existsSync(callLogFile) ? readFileSync(callLogFile, 'utf8').trim().split('\n').filter(Boolean) : []
    const deployCalls = calls.filter((line) => line.includes('prisma migrate deploy'))
    expect(deployCalls).toHaveLength(1)
  })

  it('also runs migrate status after a successful deploy', () => {
    runWrapper({ env: 'preview', preflightExitCode: 0 })

    const calls = existsSync(callLogFile) ? readFileSync(callLogFile, 'utf8').trim().split('\n').filter(Boolean) : []
    const statusCalls = calls.filter((line) => line.includes('prisma migrate status'))
    expect(statusCalls).toHaveLength(1)
  })
})

describe('wrapper execution guarantee: preflight FAIL → migrate deploy invocation count = 0', () => {
  it('never invokes prisma migrate deploy when pre-flight exits non-zero', () => {
    const result = runWrapper({ env: 'preview', preflightExitCode: 1 })

    expect(result.status).not.toBe(0)
    const calls = existsSync(callLogFile) ? readFileSync(callLogFile, 'utf8').trim().split('\n').filter(Boolean) : []
    expect(calls).toHaveLength(0)
  })

  it('prints a clear "Migration NOT executed" message on pre-flight failure', () => {
    const result = runWrapper({ env: 'production', preflightExitCode: 1 })

    expect(result.stderr).toContain('Pre-flight FAILED. Migration NOT executed.')
  })
})

describe('wrapper argument validation never reaches node/npx at all', () => {
  it('rejects a missing --env before doing anything else', () => {
    const fakePath = `${fakeBinDir}:${process.env.PATH}`
    const result = spawnSync('bash', [WRAPPER_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: fakePath, CALL_LOG_FILE: callLogFile },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(existsSync(callLogFile)).toBe(false)
  })

  it('rejects an unrecognized --env value before doing anything else', () => {
    const fakePath = `${fakeBinDir}:${process.env.PATH}`
    const result = spawnSync('bash', [WRAPPER_PATH, '--env', 'staging'], {
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: fakePath, CALL_LOG_FILE: callLogFile },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(existsSync(callLogFile)).toBe(false)
  })
})
