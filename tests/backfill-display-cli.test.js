import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// STEP 7.15f.1-c — native .cjs bootstrap tests (env policy, Vite
// fail-closed contract, require.main guard, and a real ModuleRunner
// integration proof against a synthetic operator module).
//
// Never touches the real repo .env.local and never connects to Production.

const require = createRequire(import.meta.url)
const cli = require('../scripts/backfill-display-derivatives.cjs')

const REQUIRED_VARS = ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN']

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'snaprooms-backfill-cli-test-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

afterEach(() => {
  for (const name of REQUIRED_VARS) delete process.env[name]
})

describe('enforceEnvPolicy', () => {
  it('A: required var already present in shell -> abort before loading anything', () => {
    process.env.DATABASE_URL = 'postgres://synthetic-shell-value/test'
    const result = withTempDir((dir) => {
      const envPath = join(dir, '.env.local')
      writeFileSync(envPath, 'DATABASE_URL=postgres://synthetic-file-value/test\nBLOB_READ_WRITE_TOKEN=synthetic-token\n')
      return cli.enforceEnvPolicy(envPath)
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('DATABASE_URL')
    expect(result.message).not.toContain('postgres://')
  })

  it('B: .env.local missing -> abort, non-fatal-elsewhere ENOENT is treated as fatal here', () => {
    const result = cli.enforceEnvPolicy('/tmp/snaprooms-backfill-cli-test-does-not-exist/.env.local')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/not found/i)
  })

  it('C: env file loads but a required var is still missing -> abort, names only the missing var', () => {
    const result = withTempDir((dir) => {
      const envPath = join(dir, '.env.local')
      writeFileSync(envPath, 'BLOB_READ_WRITE_TOKEN=synthetic-token\n')
      return cli.enforceEnvPolicy(envPath)
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('DATABASE_URL')
  })

  it('D: both required vars present via file -> ok:true, ready for the runner', () => {
    const result = withTempDir((dir) => {
      const envPath = join(dir, '.env.local')
      writeFileSync(envPath, 'DATABASE_URL=postgres://synthetic-file-value/test\nBLOB_READ_WRITE_TOKEN=synthetic-token\n')
      return cli.enforceEnvPolicy(envPath)
    })
    expect(result.ok).toBe(true)
    expect(process.env.DATABASE_URL).toBe('postgres://synthetic-file-value/test')
    expect(process.env.BLOB_READ_WRITE_TOKEN).toBe('synthetic-token')
  })

  it('never mentions DIRECT_URL as required', () => {
    expect(cli.REQUIRED_ENV_VARS).toEqual(['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN'])
  })
})

describe('resolveViteRuntime — fail-closed contract', () => {
  it('loader throwing -> not ok, no throw propagated', async () => {
    const result = await cli.resolveViteRuntime(async () => {
      throw new Error('simulated resolution failure')
    })
    expect(result.ok).toBe(false)
  })

  it('loaded module missing required API -> not ok', async () => {
    const result = await cli.resolveViteRuntime(async () => ({ someOtherExport: () => {} }))
    expect(result.ok).toBe(false)
  })

  it('loaded module with only createServer (no createServerModuleRunner) -> not ok', async () => {
    const result = await cli.resolveViteRuntime(async () => ({ createServer: () => {} }))
    expect(result.ok).toBe(false)
  })

  it('the REAL installed Vite resolves successfully (positive control)', async () => {
    const result = await cli.resolveViteRuntime()
    expect(result.ok).toBe(true)
    expect(typeof result.viteModule.createServer).toBe('function')
    expect(typeof result.viteModule.createServerModuleRunner).toBe('function')
  })
})

describe('CLI does not auto-run on require', () => {
  it('requiring the module does not launch main() / touch process.exitCode', () => {
    expect(process.exitCode).toBeUndefined()
    expect(typeof cli.main).toBe('function')
  })
})

describe('runtime integration proof (real, non-listening ModuleRunner, synthetic operator)', () => {
  it('env load -> Vite ModuleRunner starts non-listening -> module import succeeds -> resources close', async () => {
    const { createServer, createServerModuleRunner } = (await cli.resolveViteRuntime()).viteModule

    const dir = mkdtempSync(join(tmpdir(), 'snaprooms-backfill-cli-test-'))
    try {
      const envPath = join(dir, '.env.local')
      writeFileSync(envPath, 'DATABASE_URL=postgres://synthetic/test\nBLOB_READ_WRITE_TOKEN=synthetic-token\n')
      const envResult = cli.enforceEnvPolicy(envPath)
      expect(envResult.ok).toBe(true)

      const syntheticOperatorPath = join(dir, 'synthetic-operator.mjs')
      writeFileSync(
        syntheticOperatorPath,
        [
          'export function createRealDependencies() { return {} }',
          'export async function main(argv, dependencies) { return { exitCode: 0, mode: "synthetic" } }',
        ].join('\n'),
      )

      const server = await createServer({
        root: cli.REPO_ROOT,
        configFile: cli.VITEST_CONFIG_PATH,
        server: { middlewareMode: true, hmr: false, watch: null },
        appType: 'custom',
      })

      let runner
      try {
        runner = createServerModuleRunner(server.environments.ssr)
        const operatorModule = await runner.import(syntheticOperatorPath)
        const result = await operatorModule.main([], operatorModule.createRealDependencies())
        expect(result.exitCode).toBe(0)
        expect(result.mode).toBe('synthetic')
      } finally {
        if (runner) await runner.close()
        await server.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
