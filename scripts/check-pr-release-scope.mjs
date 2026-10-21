#!/usr/bin/env node
// Validates that a pull request's changed files stay within the approved
// release scope (no Stripe, database, auth, or event-photo paths) — with a
// narrow, diff-content-bound exception mechanism for specific, reviewed
// privacy-remediation edits (see PATH_DIFF_EXCEPTIONS below).
//
// This replaces a Vitest test that ran `git diff --name-only origin/main`,
// which is not portable: GitHub Actions' checkout does not guarantee an
// `origin/main` ref exists in the runner's working copy. This script uses
// the GitHub API's own changed-files listing (and per-file patch content)
// for the PR instead, which is authoritative regardless of what refs are
// present locally.
//
// Fails closed: any condition that prevents retrieving that authoritative
// file list (wrong event context, missing event payload, API failure, an
// empty file list, missing/unreadable patch data for an excepted file) is
// treated as a failure, not a pass.
//
// IMPORTANT — this script must only ever be executed as the BASE branch's
// reviewed copy (e.g. from a pull_request_target workflow that checks out
// github.event.pull_request.base.sha, never the PR head), not as whatever
// version a PR itself proposes. Running it as the PR's own copy would let
// a PR weaken its own gate by editing this file — see
// .github/workflows/release-scope-guard.yml.

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const OFFENDER_PATTERN = /stripe|prisma|schema\.prisma|app\/api\/events|app\/event\/|app\/dashboard\/login|password/i

/**
 * Narrow, auditable exceptions to the default-deny policy above.
 *
 * An exception is bound to the PR's actual reviewed diff *content*
 * (fetched from GitHub's API as unified-diff patch text), never to a PR's
 * title, branch name, or labels — all of which are controlled by whoever
 * opened the PR and therefore untrustworthy as an authorization signal.
 *
 * For a given file, every changed line (added OR removed; context lines
 * are ignored) in its patch must match `allowedRemovedLine` AND must be a
 * removal (a `-` line), never an addition (a `+` line). This means the
 * exception can only ever let a PR delete one specific, already-known
 * property line from this exact file — it cannot authorize adding or
 * modifying anything, including Stripe payment/webhook-signature logic,
 * even inside the same file in the same PR.
 */
export const PATH_DIFF_EXCEPTIONS = {
  'app/api/stripe/webhook/route.js': {
    description: 'PRIVACY-SERVER-001: removal of the stripe_customer_id PostHog event property only',
    allowedRemovedLine: /^stripe_customer_id:\s*session\.customer,\s*$/,
  },
}

function fail(message) {
  console.error(`[check-pr-release-scope] FAIL: ${message}`)
  return false
}

/**
 * Parse `gh api --paginate --jq '.[] | {...}'` output into an array of
 * objects.
 *
 * `--paginate` fetches every page of the PR's changed-files list, but
 * applies the `--jq` filter to EACH page separately and concatenates the
 * raw text output across pages. A `--jq` filter that wraps results in an
 * array (e.g. `'[.[] | {...}]'`) therefore produces multiple separate
 * JSON array literals concatenated back-to-back for any PR spanning more
 * than one page (100+ changed files) — which is not valid JSON and would
 * throw on `JSON.parse`. This script instead uses an unwrapped `--jq`
 * filter (one JSON object per line, effectively NDJSON), which
 * concatenates safely across any number of pages: each line is parsed
 * independently here.
 *
 * Fails closed: any unparsable line fails the whole batch rather than
 * silently skipping it.
 */
export function parseGhApiNdjsonOutput(raw) {
  if (typeof raw !== 'string') return null
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  const parsed = []
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line))
    } catch {
      return null
    }
  }
  return parsed
}

/**
 * Parse a unified-diff patch (as returned by GitHub's PR-files API, which
 * omits the `--- a/`/`+++ b/` file headers) into just its changed lines.
 * Context lines (leading space) and hunk headers (`@@ ... @@`) are
 * dropped — only additions and removals are actionable for an exception.
 */
export function parsePatchChangedLines(patch) {
  if (typeof patch !== 'string') return null
  return patch
    .split('\n')
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .filter((line) => !line.startsWith('+++') && !line.startsWith('---'))
    .map((line) => ({ marker: line[0], content: line.slice(1).trim() }))
}

/**
 * Whether a single path string falls inside the default-deny policy.
 * Treats a missing/empty path as non-offending (nothing to flag).
 */
export function isPathOffending(path) {
  return typeof path === 'string' && path.length > 0 && OFFENDER_PATTERN.test(path)
}

/**
 * GitHub's `GET /pulls/{pull_number}/files` endpoint returns at most 3000
 * files for any PR, with no in-band truncation signal — unlike the
 * compare-commits endpoint, there is no `truncated: true` flag. A PR with
 * more than 3000 changed files would silently have files missing from
 * this guard's view, which could evaluate as SUCCESS despite an
 * unreviewed sensitive-path change sitting past the cutoff (CI-GOV-011A
 * finding). This checks the PR's own authoritative `changed_files` count
 * (from a separate, cheap, non-paginated API call) before ever trusting
 * the paginated file list.
 */
export function validateChangedFilesCount(changedFiles) {
  if (!Number.isSafeInteger(changedFiles) || changedFiles <= 0) {
    return { ok: false, reason: `changed_files is not a positive safe integer: ${JSON.stringify(changedFiles)}` }
  }
  if (changedFiles > 3000) {
    return {
      ok: false,
      reason: `PR has ${changedFiles} changed files, exceeding GitHub's 3000-file API limit for this endpoint — this guard cannot authoritatively evaluate a PR this large (see CI-GOV-011A)`,
    }
  }
  return { ok: true }
}

/**
 * Parses the PR metadata response (`GET /pulls/{pull_number}`) into just
 * the two fields this guard needs. Fails closed (returns null) on any
 * missing/malformed field rather than proceeding with a partial object.
 */
export function parsePrMetadataJson(raw) {
  if (typeof raw !== 'string') return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const changedFiles = parsed?.changed_files
  const headSha = parsed?.head_sha
  if (typeof headSha !== 'string' || headSha.length === 0) return null
  return { changedFiles, headSha }
}

/**
 * Rejects (rather than silently deduplicating) a missing/empty filename
 * or a duplicate filename across the retrieved file list — either would
 * mean this guard's view of the PR's files is not a clean 1:1 match with
 * what GitHub is actually reporting, which is exactly the kind of
 * malformed/misleading data this guard must fail closed on rather than
 * evaluate partially.
 */
export function validateFileRecords(filesWithPatches) {
  const seen = new Set()
  for (const { filename } of filesWithPatches) {
    if (typeof filename !== 'string' || filename.length === 0) {
      return { ok: false, reason: 'a file record is missing a nonempty filename' }
    }
    if (seen.has(filename)) {
      return { ok: false, reason: `duplicate filename in PR files list: ${filename}` }
    }
    seen.add(filename)
  }
  return { ok: true }
}

/**
 * Whether two PR head SHAs agree — used both to confirm the metadata
 * fetched at guard start matches the SHA that actually triggered the
 * event, and to confirm the head SHA hasn't moved (e.g. a force-push)
 * during the time this guard spent fetching the file list — closing the
 * TOCTOU window identified in CI-GOV-011A.
 */
export function headShasMatch(a, b) {
  return typeof a === 'string' && a.length > 0 && typeof b === 'string' && a === b
}

/**
 * Decide whether one file's change is covered by its exception, given the
 * file's actual patch text. Returns { allowed, reason }.
 */
export function evaluateException(filename, patch) {
  const exception = PATH_DIFF_EXCEPTIONS[filename]
  if (!exception) {
    return { allowed: false, reason: `no exception is defined for ${filename}` }
  }

  const changedLines = parsePatchChangedLines(patch)
  if (changedLines === null) {
    return { allowed: false, reason: `no readable patch data for ${filename} (fails closed)` }
  }
  if (changedLines.length === 0) {
    return { allowed: false, reason: `empty patch for ${filename} (fails closed)` }
  }

  for (const { marker, content } of changedLines) {
    if (marker === '+') {
      return { allowed: false, reason: `${filename} has an added line, which no exception permits: "${content}"` }
    }
    if (!exception.allowedRemovedLine.test(content)) {
      return { allowed: false, reason: `${filename} removes a line outside its approved exception: "${content}"` }
    }
  }

  return { allowed: true, reason: exception.description }
}

/**
 * Pure decision function: given the PR's changed files (each with its
 * filename, previous filename when renamed, and patch text, exactly as
 * GitHub's API reports them), decide whether the PR passes release-scope
 * validation.
 *
 * Checks BOTH `filename` (the file's current/new path) and
 * `previous_filename` (its path before a rename, when present) against
 * the default-deny pattern. Without this, a PR could rename a sensitive
 * file (e.g. app/api/stripe/webhook/route.js) to a non-matching path
 * while also modifying its contents — the new `filename` alone would
 * never trigger the denylist, letting arbitrary changes to that file's
 * logic bypass the guard entirely. Any exception is still evaluated
 * against the file's *current* path only, so a rename-away never
 * incidentally inherits an exception meant for the original path.
 *
 * @param {{filename: string, previous_filename?: string, patch?: string}[]} filesWithPatches
 * @returns {{ ok: boolean, offenders: string[], exceptions: string[] }}
 */
export function evaluateFiles(filesWithPatches) {
  const offenders = []
  const exceptionsUsed = []

  for (const { filename, previous_filename: previousFilename, patch } of filesWithPatches) {
    const touchesSensitivePath = isPathOffending(filename) || isPathOffending(previousFilename)
    if (!touchesSensitivePath) continue

    const { allowed, reason } = evaluateException(filename, patch)
    if (allowed) {
      exceptionsUsed.push(`${filename} (${reason})`)
    } else {
      const renameNote =
        previousFilename && previousFilename !== filename ? ` (renamed from ${previousFilename})` : ''
      offenders.push(`${filename}${renameNote} — ${reason}`)
    }
  }

  return { ok: offenders.length === 0, offenders, exceptions: exceptionsUsed }
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' && process.env.GITHUB_EVENT_NAME !== 'pull_request_target') {
    return fail(`expected to run only in a pull_request(_target) event context, got "${process.env.GITHUB_EVENT_NAME}"`)
  }

  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return fail('GITHUB_EVENT_PATH is not set')

  let event
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf8'))
  } catch (e) {
    return fail(`could not read/parse GITHUB_EVENT_PATH: ${e.message}`)
  }

  const prNumber = event?.pull_request?.number
  const repo = process.env.GITHUB_REPOSITORY
  if (!prNumber || !repo) return fail('could not determine PR number or repository from event payload')

  const eventHeadSha = event?.pull_request?.head?.sha
  if (typeof eventHeadSha !== 'string' || eventHeadSha.length === 0) {
    return fail('event payload is missing pull_request.head.sha')
  }

  // Step 1: fetch the PR's own authoritative metadata (changed_files,
  // head.sha) BEFORE trusting the paginated file list — see
  // validateChangedFilesCount/parsePrMetadataJson for why (CI-GOV-011A:
  // the files-list endpoint has no in-band truncation signal at all).
  let metadataRaw
  try {
    metadataRaw = execSync(`gh api repos/${repo}/pulls/${prNumber} --jq '{changed_files: .changed_files, head_sha: .head.sha}'`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  } catch (e) {
    return fail(`gh api call for PR metadata failed: ${e.message}`)
  }

  const metadata = parsePrMetadataJson(metadataRaw)
  if (metadata === null) {
    return fail('could not parse gh api PR metadata response — fails closed')
  }

  const countCheck = validateChangedFilesCount(metadata.changedFiles)
  if (!countCheck.ok) {
    return fail(countCheck.reason)
  }

  if (!headShasMatch(metadata.headSha, eventHeadSha)) {
    return fail(
      `PR head SHA changed between event trigger and metadata fetch (event: ${eventHeadSha}, metadata: ${metadata.headSha}) — stale evaluation, fails closed`
    )
  }

  // Step 2: fetch the paginated file list, exactly as before.
  let raw
  try {
    raw = execSync(
      `gh api repos/${repo}/pulls/${prNumber}/files --paginate --jq '.[] | {filename: .filename, previous_filename: .previous_filename, patch: .patch}'`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }
    )
  } catch (e) {
    return fail(`gh api call for PR changed files failed: ${e.message}`)
  }

  const filesWithPatches = parseGhApiNdjsonOutput(raw)
  if (filesWithPatches === null) {
    return fail('could not parse gh api response (malformed line in paginated output) — fails closed')
  }

  if (filesWithPatches.length === 0) {
    return fail('GitHub API returned zero changed files for this PR — cannot authoritatively validate scope')
  }

  const recordsCheck = validateFileRecords(filesWithPatches)
  if (!recordsCheck.ok) {
    return fail(recordsCheck.reason)
  }

  if (filesWithPatches.length !== metadata.changedFiles) {
    return fail(
      `changed_files count mismatch: PR metadata declares ${metadata.changedFiles}, but the files API returned ${filesWithPatches.length} — treating as incomplete/inconsistent data, fails closed`
    )
  }

  // Step 3: re-fetch the head SHA once more, after the (potentially slow,
  // multi-page) file retrieval above — closes the TOCTOU window where a
  // force-push could land between steps 1 and 2 and leave this guard
  // evaluating a file list for a commit that is no longer the PR's head.
  let headShaAfterRaw
  try {
    headShaAfterRaw = execSync(`gh api repos/${repo}/pulls/${prNumber} --jq '.head.sha'`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim()
  } catch (e) {
    return fail(`gh api call to re-check PR head SHA failed: ${e.message}`)
  }

  if (!headShasMatch(headShaAfterRaw, metadata.headSha)) {
    return fail(
      `PR head SHA changed during file retrieval (was: ${metadata.headSha}, now: ${headShaAfterRaw}) — stale evaluation, fails closed`
    )
  }

  const { ok, offenders, exceptions } = evaluateFiles(filesWithPatches)

  if (!ok) {
    return fail(`out-of-scope files detected in PR diff (Stripe/database/auth/event-photo paths): ${offenders.join('; ')}`)
  }

  if (exceptions.length > 0) {
    console.log(`[check-pr-release-scope] OK — ${exceptions.length} narrow exception(s) applied: ${exceptions.join('; ')}`)
  }
  console.log(`[check-pr-release-scope] OK — ${filesWithPatches.length} changed file(s) checked, no out-of-scope paths detected.`)
  return true
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirectExecution) {
  const ok = main()
  if (!ok) process.exit(1)
}
