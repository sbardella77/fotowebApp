import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8')

function listFilesRecursive(dir, exts) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, exts))
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

describe('PostHog read adapter — security contract', () => {
  it('1. the query transport module is never imported from a client component', () => {
    const clientLikeDirs = ['components', 'app']
    const offenders = []
    for (const dir of clientLikeDirs) {
      for (const file of listFilesRecursive(resolve(ROOT, dir), ['.jsx', '.js'])) {
        const source = readFileSync(file, 'utf8')
        const isClientComponent = source.includes("'use client'") || source.includes('"use client"')
        if (isClientComponent && /posthog-query|admin-analytics-posthog/.test(source)) {
          offenders.push(file)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('2. the new PostHog query env vars are server-only (never NEXT_PUBLIC_*)', () => {
    const source = read('lib/server/posthog-query.js')
    expect(source).toContain('process.env.POSTHOG_PERSONAL_API_KEY')
    expect(source).toContain('process.env.POSTHOG_PROJECT_ID')
    expect(source).not.toMatch(/NEXT_PUBLIC_POSTHOG_PERSONAL_API_KEY|NEXT_PUBLIC_POSTHOG_PROJECT_ID/)
    // The existing client-side ingestion var must stay separate from the
    // privileged query host — the transport module must not READ it (the
    // doc comment mentions it by name only to explain why not to).
    expect(source).not.toContain('process.env.NEXT_PUBLIC_POSTHOG_HOST')
  })

  it('the transport module never logs the Authorization header, the key, or the raw response body', () => {
    const source = read('lib/server/posthog-query.js')
    const consoleCalls = source.match(/console\.(log|error|warn)\(.*\)/g) || []
    expect(consoleCalls.length).toBeGreaterThan(0)
    for (const call of consoleCalls) {
      expect(call).not.toMatch(/apiKey|Authorization|Bearer/i)
      expect(call).not.toMatch(/JSON\.stringify\(body\)|\bbody\)/)
    }
  })

  it('6. business metric queries never interpolate anything beyond fixed literals and server-derived timestamps', () => {
    const source = read('lib/server/admin-analytics-posthog.js')
    // The only external input this module accepts is `range`; every
    // runHogQLQuery() call site builds its template from `since`/`until`
    // (computed once via resolveRangeBounds) and fixed constants only — the
    // raw `range` string itself must never appear inside a query template.
    const queryTemplates = source.match(/runHogQLQuery\(\s*`[\s\S]*?`/g) || []
    expect(queryTemplates.length).toBeGreaterThan(0)
    for (const template of queryTemplates) {
      expect(template).not.toMatch(/\$\{range\}/)
    }
    expect(source).not.toMatch(/\brequest\.|searchParams|next\/server/)
  })

  it('there is no generic query/SQL-passthrough endpoint anywhere in the catch-all router', () => {
    const source = read('app/api/[[...path]]/route.js')
    expect(source).not.toMatch(/segments\[1\] === 'posthog'/)
    expect(source).not.toMatch(/segments\[1\] === 'query'/)
  })
})
