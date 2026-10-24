#!/usr/bin/env node
// Non-blocking reminder: if this PR adds new files under prisma/migrations/,
// print a loud GitHub Actions warning annotation pointing at the mandatory
// post-merge deploy sequence (docs/production-deploy-checklist.md,
// scripts/run-migration-safe.sh). Never fails the build and never touches
// any database — this is purely a visibility aid for the person merging,
// after a 2026-10-24 incident where merged migrations were never applied
// to production (login/password-reset broke for real users until caught).
//
// Intentionally does NOT attempt to connect to any database or run
// `prisma migrate status`/`deploy` — see docs/production-deploy-checklist.md
// for why migrations must only ever run through the guarded sequence.

import { execSync } from 'node:child_process'

function listNewMigrationFiles() {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main'
  try {
    execSync(`git fetch origin ${process.env.GITHUB_BASE_REF || 'main'} --depth=50`, { stdio: 'ignore' })
  } catch {
    // Best-effort — if fetch fails we still try the diff with whatever refs are present.
  }
  let diffOutput = ''
  try {
    diffOutput = execSync(`git diff --name-status ${base}...HEAD -- prisma/migrations/`, { encoding: 'utf8' })
  } catch (error) {
    console.warn(`[migration-reminder] Could not compute diff against ${base}: ${error.message}`)
    return []
  }
  return diffOutput
    .split('\n')
    .filter((line) => line.startsWith('A\t') && line.endsWith('/migration.sql'))
    .map((line) => line.slice(2))
}

const newMigrations = listNewMigrationFiles()

if (newMigrations.length > 0) {
  console.log('::warning::This PR adds new Prisma migration file(s). Merging alone does NOT apply them to any database.')
  for (const file of newMigrations) {
    console.log(`::warning file=${file}::New migration — remember the post-merge deploy sequence below.`)
  }
  console.log('')
  console.log('[migration-reminder] New migration file(s) detected:')
  for (const file of newMigrations) console.log(`  - ${file}`)
  console.log('')
  console.log('[migration-reminder] After merging, apply via the guarded sequence (see docs/production-deploy-checklist.md):')
  console.log('[migration-reminder]   npm run db:migrate:preview     # or')
  console.log('[migration-reminder]   npm run db:migrate:production')
  console.log('[migration-reminder] Never run `prisma migrate deploy` directly.')
} else {
  console.log('[migration-reminder] No new migration files in this PR.')
}

process.exit(0)
