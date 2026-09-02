import { describe, it, expect } from 'vitest'
import fs from 'fs'
import {
  checkAppUrl,
  checkEnv,
  shouldExecute,
  TEST_EMAIL,
  PRODUCTION_HOSTNAME,
} from '../scripts/incident-test-reset-flow.mjs'

// Source-level safety contract for scripts/incident-test-reset-flow.mjs.
// Importing the module itself never triggers its mutating flow (it is
// guarded behind an `isMainModule` check), and this file never calls
// runFlow / hits a real database or network endpoint.

const scriptUrl = new URL('../scripts/incident-test-reset-flow.mjs', import.meta.url)
const scriptSource = fs.readFileSync(scriptUrl, 'utf8')

describe('tracked " 2" cleanup', () => {
  it('no stray " 2" script paths remain, and the renamed script exists', () => {
    expect(fs.existsSync(new URL('../scripts/incident-test-reset-flow 2.mjs', import.meta.url))).toBe(false)
    expect(fs.existsSync(new URL('../scripts/migrate-local-json-to-prisma 2.js', import.meta.url))).toBe(false)
    expect(fs.existsSync(scriptUrl)).toBe(true)
  })
})

describe('incident-test-reset-flow.mjs safety contract', () => {
  it('the old production-looking default APP_URL is gone from source', () => {
    expect(scriptSource).not.toContain('fotoweb-app.vercel.app')
  })

  describe('APP_URL is required and production hosts are rejected', () => {
    it('rejects when APP_URL is missing', () => {
      const result = checkAppUrl({})
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Missing APP_URL/)
    })

    it('accepts a non-production APP_URL', () => {
      const result = checkAppUrl({ APP_URL: 'http://localhost:3000' })
      expect(result.ok).toBe(true)
      expect(result.value).toBe('http://localhost:3000')
    })

    it('rejects the production apex domain', () => {
      const result = checkAppUrl({ APP_URL: `https://${PRODUCTION_HOSTNAME}` })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/production host/)
    })

    it('rejects a production subdomain', () => {
      const result = checkAppUrl({ APP_URL: `https://app.${PRODUCTION_HOSTNAME}` })
      expect(result.ok).toBe(false)
    })

    it('does not false-positive on an unrelated host that merely contains the domain as a substring', () => {
      const result = checkAppUrl({ APP_URL: 'https://notsnaprooms.app.evil.example' })
      expect(result.ok).toBe(true)
    })

    it('rejects an unparsable APP_URL', () => {
      const result = checkAppUrl({ APP_URL: 'not-a-url' })
      expect(result.ok).toBe(false)
    })
  })

  describe('production environment is rejected', () => {
    it('rejects when NODE_ENV is production, even with a valid INCIDENT_TEST_ENV', () => {
      const result = checkEnv({ NODE_ENV: 'production', INCIDENT_TEST_ENV: 'development' })
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/NODE_ENV/)
    })

    it('rejects when INCIDENT_TEST_ENV is unset', () => {
      const result = checkEnv({})
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/INCIDENT_TEST_ENV/)
    })

    it('rejects when INCIDENT_TEST_ENV is "production"', () => {
      const result = checkEnv({ INCIDENT_TEST_ENV: 'production' })
      expect(result.ok).toBe(false)
    })

    it('accepts INCIDENT_TEST_ENV of "development" or "preview"', () => {
      expect(checkEnv({ INCIDENT_TEST_ENV: 'development' }).ok).toBe(true)
      expect(checkEnv({ INCIDENT_TEST_ENV: 'preview' }).ok).toBe(true)
    })

    it('has no casual --force style bypass flag in source', () => {
      expect(scriptSource).not.toMatch(/--force/)
    })
  })

  describe('mutation requires an explicit execution gate', () => {
    it('shouldExecute is false without --execute', () => {
      expect(shouldExecute(['node', 'incident-test-reset-flow.mjs'])).toBe(false)
    })

    it('shouldExecute is true with --execute', () => {
      expect(shouldExecute(['node', 'incident-test-reset-flow.mjs', '--execute'])).toBe(true)
    })

    it('the mutating path (runFlow) is only reached when shouldExecute is true', () => {
      expect(scriptSource).toMatch(/if \(!shouldExecute\(process\.argv\)\) \{\s*printPlan\(appUrl\)\s*return\s*\}/)
      expect(scriptSource).toMatch(/await runFlow\(appUrl\)/)
    })

    it('the entry point only runs when this file is executed directly, not on import', () => {
      expect(scriptSource).toMatch(/const isMainModule = import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`/)
      expect(scriptSource).toMatch(/if \(isMainModule\) \{\s*main\(\)\s*\}/)
    })
  })

  it('the dedicated test identity is retained and cannot be overridden via CLI or env', () => {
    expect(TEST_EMAIL).toBe('incident-test-reset@snaprooms.app')
    // TEST_EMAIL must be a hardcoded literal, not read from argv or env
    // (process.argv is legitimately used elsewhere for --execute and the
    // main-module check, so only the TEST_EMAIL declaration itself matters).
    expect(scriptSource).toContain("export const TEST_EMAIL = 'incident-test-reset@snaprooms.app'")
    expect(scriptSource).not.toMatch(/process\.env\.(TEST_EMAIL|TARGET_EMAIL|OWNER_EMAIL)/)
  })

  describe('cleanup stays scoped to the dedicated test identity', () => {
    it('cleanup() looks up the owner by TEST_EMAIL before deleting anything', () => {
      const start = scriptSource.indexOf('async function cleanup()')
      const cleanupSource = scriptSource.slice(start, scriptSource.indexOf('\n}', start))
      expect(cleanupSource).toContain('findUnique({ where: { email: TEST_EMAIL } })')
      expect(cleanupSource).toContain('deleteMany({ where: { ownerId: owner.id } })')
      expect(cleanupSource).toContain('delete({ where: { id: owner.id } })')
    })

    it('has no unscoped deleteMany, truncate, or drop anywhere in the script', () => {
      expect(scriptSource).not.toMatch(/deleteMany\(\s*\)/)
      expect(scriptSource).not.toMatch(/deleteMany\(\s*\{\s*\}\s*\)/)
      expect(scriptSource.toLowerCase()).not.toMatch(/truncate|drop table/)
    })
  })
})
