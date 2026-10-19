#!/usr/bin/env node
// Validates that a pull request's changed files stay within the approved
// release scope (no Stripe, database, auth, or event-photo paths).
//
// This replaces a Vitest test that ran `git diff --name-only origin/main`,
// which is not portable: GitHub Actions' checkout does not guarantee an
// `origin/main` ref exists in the runner's working copy. This script uses
// the GitHub API's own changed-files listing for the PR instead, which is
// authoritative regardless of what refs are present locally.
//
// Fails closed: any condition that prevents retrieving that authoritative
// file list (wrong event context, missing event payload, API failure, an
// empty file list) is treated as a failure, not a pass.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const OFFENDER_PATTERN = /stripe|prisma|schema\.prisma|app\/api\/events|app\/event\/|app\/dashboard\/login|password/i

function fail(message) {
  console.error(`[check-pr-release-scope] FAIL: ${message}`)
  process.exit(1)
}

if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
  fail(`expected to run only in a pull_request event context, got "${process.env.GITHUB_EVENT_NAME}"`)
}

const eventPath = process.env.GITHUB_EVENT_PATH
if (!eventPath) fail('GITHUB_EVENT_PATH is not set')

let event
try {
  event = JSON.parse(readFileSync(eventPath, 'utf8'))
} catch (e) {
  fail(`could not read/parse GITHUB_EVENT_PATH: ${e.message}`)
}

const prNumber = event?.pull_request?.number
const repo = process.env.GITHUB_REPOSITORY
if (!prNumber || !repo) fail('could not determine PR number or repository from event payload')

let filesOutput
try {
  filesOutput = execSync(
    `gh api repos/${repo}/pulls/${prNumber}/files --paginate --jq '.[].filename'`,
    { encoding: 'utf8' }
  )
} catch (e) {
  fail(`gh api call for PR changed files failed: ${e.message}`)
}

const files = filesOutput.split('\n').map((f) => f.trim()).filter(Boolean)
if (files.length === 0) {
  fail('GitHub API returned zero changed files for this PR — cannot authoritatively validate scope')
}

const offenders = files.filter((f) => OFFENDER_PATTERN.test(f))
if (offenders.length > 0) {
  fail(`out-of-scope files detected in PR diff (Stripe/database/auth/event-photo paths): ${offenders.join(', ')}`)
}

console.log(`[check-pr-release-scope] OK — ${files.length} changed file(s) checked, no out-of-scope paths detected.`)
