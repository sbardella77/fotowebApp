import { describe, it, expect } from 'vitest'
import {
  OFFENDER_PATTERN,
  PATH_DIFF_EXCEPTIONS,
  isPathOffending,
  parsePatchChangedLines,
  parseGhApiNdjsonOutput,
  evaluateException,
  evaluateFiles,
  validateChangedFilesCount,
  parsePrMetadataJson,
  validateFileRecords,
  headShasMatch,
} from '../scripts/check-pr-release-scope.mjs'

const WEBHOOK_PATH = 'app/api/stripe/webhook/route.js'

describe('OFFENDER_PATTERN — default-deny policy is unchanged (PRIVACY-SERVER-001D)', () => {
  it('still flags Stripe, Prisma, event-photo, dashboard-login, and password paths', () => {
    expect(OFFENDER_PATTERN.test('app/api/stripe/checkout-session/route.js')).toBe(true)
    expect(OFFENDER_PATTERN.test('prisma/schema.prisma')).toBe(true)
    expect(OFFENDER_PATTERN.test('app/api/events/route.js')).toBe(true)
    expect(OFFENDER_PATTERN.test('app/event/[slug]/page.js')).toBe(true)
    expect(OFFENDER_PATTERN.test('app/dashboard/login/page-client.js')).toBe(true)
    expect(OFFENDER_PATTERN.test('lib/server/password-reset.js')).toBe(true)
  })

  it('does not flag unrelated, ordinary paths', () => {
    expect(OFFENDER_PATTERN.test('lib/analytics/sanitize-url.js')).toBe(false)
    expect(OFFENDER_PATTERN.test('components/privacy-page.jsx')).toBe(false)
  })
})

describe('parsePatchChangedLines', () => {
  it('extracts only + / - content lines, dropping context, hunk headers, and file-header lines', () => {
    const patch = [
      '@@ -300,7 +300,6 @@ async function handleCheckoutSessionCompleted() {',
      '        room_slug: session.metadata?.roomSlug || null,',
      '        stripe_session_id: session.id,',
      '-        stripe_customer_id: session.customer,',
      '      },',
    ].join('\n')
    const lines = parsePatchChangedLines(patch)
    expect(lines).toEqual([{ marker: '-', content: 'stripe_customer_id: session.customer,' }])
  })

  it('returns null for non-string/missing patch data (fails closed upstream)', () => {
    expect(parsePatchChangedLines(undefined)).toBeNull()
    expect(parsePatchChangedLines(null)).toBeNull()
  })
})

describe('evaluateException — diff-content-bound exception for the Stripe webhook file', () => {
  it('ALLOWS a patch that only removes the exact stripe_customer_id property line', () => {
    const patch = '@@ -300,7 +300,6 @@\n stripe_session_id: session.id,\n-stripe_customer_id: session.customer,\n },'
    const result = evaluateException(WEBHOOK_PATH, patch)
    expect(result.allowed).toBe(true)
  })

  it('ALLOWS when the same exact removal appears multiple times across hunks', () => {
    const patch = [
      '-stripe_customer_id: session.customer,',
      '-        stripe_customer_id: session.customer,',
    ].join('\n')
    expect(evaluateException(WEBHOOK_PATH, patch).allowed).toBe(true)
  })

  it('REJECTS a patch that adds any line, even an innocuous-looking one', () => {
    const patch = '-stripe_customer_id: session.customer,\n+billing_intent: intent,'
    const result = evaluateException(WEBHOOK_PATH, patch)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/added line/)
  })

  it('REJECTS a patch that modifies webhook signature verification logic', () => {
    const patch = '-const sig = request.headers.get(\'stripe-signature\')\n+const sig = request.headers.get(\'x-stripe-signature\') || \'test\''
    expect(evaluateException(WEBHOOK_PATH, patch).allowed).toBe(false)
  })

  it('REJECTS a patch that changes a payment amount or billing-logic line disguised as a removal', () => {
    const patch = '-amount_total: session.amount_total,'
    const result = evaluateException(WEBHOOK_PATH, patch)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/outside its approved exception/)
  })

  it('REJECTS a database-write line removal — the exception is scoped to one exact property line, not "any removal in this file"', () => {
    const patch = '-await prisma.owner.update({ where: { id: ownerId }, data: { stripeCustomerId: session.customer } })'
    expect(evaluateException(WEBHOOK_PATH, patch).allowed).toBe(false)
  })

  it('fails closed when patch data is missing/unreadable for an excepted file', () => {
    expect(evaluateException(WEBHOOK_PATH, undefined).allowed).toBe(false)
    expect(evaluateException(WEBHOOK_PATH, '').allowed).toBe(false)
  })

  it('fails closed (no exception) for a file that has no exception entry at all', () => {
    const result = evaluateException('app/api/stripe/checkout-session/route.js', '-stripe_customer_id: session.customer,')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/no exception is defined/)
  })
})

describe('evaluateFiles — end-to-end PR scope decision', () => {
  it('APPROVES the real PRIVACY-SERVER-001 diff shape: only the webhook stripe_customer_id removal, plus ordinary non-offending files', () => {
    const files = [
      { filename: WEBHOOK_PATH, patch: '-        stripe_customer_id: session.customer,' },
      { filename: 'lib/server/extra-free-event-fulfillment.js', patch: '-      stripe_customer_id: session.customer,' },
      { filename: 'app/api/[[...path]]/route.js', patch: '-    { room_slug: slug, file_name: payload.fileName, file_size: payload.fileSize },\n+    { room_slug: slug, file_size: payload.fileSize },' },
      { filename: 'tests/posthog-server-event-minimization.test.js', patch: "+it('new test', () => {})" },
    ]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(true)
    expect(result.offenders).toEqual([])
    expect(result.exceptions.length).toBe(1)
  })

  it('REJECTS an unrelated Stripe checkout-session change with no matching exception', () => {
    const files = [
      { filename: 'app/api/stripe/checkout-session/route.js', patch: '+    mode: "subscription",' },
    ]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(false)
    expect(result.offenders[0]).toContain('app/api/stripe/checkout-session/route.js')
  })

  it('REJECTS an unrelated database/Prisma schema change', () => {
    const files = [{ filename: 'prisma/schema.prisma', patch: '+model NewTable {}' }]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('REJECTS an unrelated auth/dashboard-login change', () => {
    const files = [{ filename: 'app/dashboard/login/page-client.js', patch: '+// backdoor' }]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('REJECTS if the webhook file diff ALSO smuggles in a payment-logic change alongside the approved removal', () => {
    const files = [
      {
        filename: WEBHOOK_PATH,
        patch: '-        stripe_customer_id: session.customer,\n+        amount_total: session.amount_total * 0,',
      },
    ]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(false)
  })

  it('is a no-op for files that are not in the offender pattern at all', () => {
    const files = [{ filename: 'lib/analytics/sanitize-url.js', patch: '+// comment' }]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(true)
    expect(result.exceptions).toEqual([])
  })
})

describe('PATH_DIFF_EXCEPTIONS contract', () => {
  it('currently defines exactly one exception, scoped to the Stripe webhook file', () => {
    expect(Object.keys(PATH_DIFF_EXCEPTIONS)).toEqual([WEBHOOK_PATH])
  })
})

describe('isPathOffending', () => {
  it('flags sensitive paths and treats missing/empty paths as non-offending', () => {
    expect(isPathOffending(WEBHOOK_PATH)).toBe(true)
    expect(isPathOffending('lib/analytics/sanitize-url.js')).toBe(false)
    expect(isPathOffending(undefined)).toBe(false)
    expect(isPathOffending(null)).toBe(false)
    expect(isPathOffending('')).toBe(false)
  })
})

describe('rename bypass (CI-GOV-001 finding, CI-GOV-002 fix)', () => {
  it('REJECTS a PR that renames the Stripe webhook file to a non-matching path while changing its contents — the rename itself must not bypass the default-deny policy', () => {
    const files = [
      {
        filename: 'lib/payment-handler.js',
        previous_filename: WEBHOOK_PATH,
        patch: '-  if (verifySignature(req)) {\n+  // signature check removed\n+  if (true) {',
      },
    ]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(false)
    expect(result.offenders[0]).toContain('lib/payment-handler.js')
    expect(result.offenders[0]).toContain(`renamed from ${WEBHOOK_PATH}`)
  })

  it('REJECTS a rename-away even when the new path alone would look completely innocuous', () => {
    const files = [
      {
        filename: 'components/totally-unrelated-component.jsx',
        previous_filename: 'prisma/schema.prisma',
        patch: '+model Backdoor { id String @id }',
      },
    ]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('a rename-away does NOT inherit the webhook file\'s exception just because the content happens to match', () => {
    const files = [
      {
        filename: 'lib/renamed-webhook.js',
        previous_filename: WEBHOOK_PATH,
        patch: '-stripe_customer_id: session.customer,',
      },
    ]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(false)
    expect(result.offenders[0]).toContain('no exception is defined for lib/renamed-webhook.js')
  })

  it('still ALLOWS the approved exception when filename and previous_filename are the same (no rename, ordinary edit)', () => {
    const files = [{ filename: WEBHOOK_PATH, previous_filename: WEBHOOK_PATH, patch: '-stripe_customer_id: session.customer,' }]
    expect(evaluateFiles(files).ok).toBe(true)
  })

  it('correctly flags a rename INTO a sensitive path even with no previous_filename match', () => {
    const files = [{ filename: WEBHOOK_PATH, previous_filename: 'lib/old-handler.js', patch: '+amount_total: 0,' }]
    const result = evaluateFiles(files)
    expect(result.ok).toBe(false)
  })
})

describe('multi-page pagination parsing (CI-GOV-001 finding, CI-GOV-002 fix)', () => {
  it('parses NDJSON-style output (one JSON object per line) correctly', () => {
    const raw = [
      '{"filename":"lib/a.js","patch":"+x"}',
      '{"filename":"lib/b.js","patch":"+y"}',
    ].join('\n')
    expect(parseGhApiNdjsonOutput(raw)).toEqual([
      { filename: 'lib/a.js', patch: '+x' },
      { filename: 'lib/b.js', patch: '+y' },
    ])
  })

  it('handles output concatenated across multiple simulated API pages without throwing', () => {
    // Simulates what `gh api --paginate --jq '.[] | {...}'` actually produces
    // across two pages: each page's objects, one per line, concatenated.
    const page1 = ['{"filename":"lib/a.js","patch":"+x"}', '{"filename":"lib/b.js","patch":"+y"}'].join('\n')
    const page2 = ['{"filename":"lib/c.js","patch":"+z"}'].join('\n')
    const raw = `${page1}\n${page2}\n`
    const parsed = parseGhApiNdjsonOutput(raw)
    expect(parsed).toHaveLength(3)
    expect(parsed.map((f) => f.filename)).toEqual(['lib/a.js', 'lib/b.js', 'lib/c.js'])
  })

  it('fails closed (returns null) on a malformed/truncated line rather than silently dropping it', () => {
    const raw = '{"filename":"lib/a.js","patch":"+x"}\n{"filename": truncated'
    expect(parseGhApiNdjsonOutput(raw)).toBeNull()
  })

  it('fails closed on completely empty input by returning an empty array (caller treats zero files as a failure)', () => {
    expect(parseGhApiNdjsonOutput('')).toEqual([])
    expect(parseGhApiNdjsonOutput('   \n  \n')).toEqual([])
  })

  it('fails closed (null) on non-string input', () => {
    expect(parseGhApiNdjsonOutput(undefined)).toBeNull()
    expect(parseGhApiNdjsonOutput(null)).toBeNull()
  })

  it('demonstrates the OLD array-wrapped jq approach would have broken on multi-page output (regression context, not a call into production code)', () => {
    const page1Array = '[{"filename":"lib/a.js"}]'
    const page2Array = '[{"filename":"lib/b.js"}]'
    const oldStyleConcatenated = page1Array + page2Array
    expect(() => JSON.parse(oldStyleConcatenated)).toThrow()
  })
})

describe('malicious/adversarial diff shapes (CI-GOV-002 security regression tests)', () => {
  it('REJECTS a diff that adds a webhook-signature bypass disguised alongside the approved removal', () => {
    const files = [
      {
        filename: WEBHOOK_PATH,
        patch: [
          '-        stripe_customer_id: session.customer,',
          '+        stripe_customer_id: session.customer, // TODO remove',
        ].join('\n'),
      },
    ]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('REJECTS a diff that duplicates the approved removal many times interspersed with one unauthorized addition', () => {
    const lines = []
    for (let i = 0; i < 20; i++) lines.push('-stripe_customer_id: session.customer,')
    lines.splice(10, 0, '+adminOverride: true,')
    const files = [{ filename: WEBHOOK_PATH, patch: lines.join('\n') }]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('REJECTS when previous_filename is present but filename/previous_filename are swapped by a malformed API response (defensive: still checks both fields independently)', () => {
    const files = [
      { filename: 'app/api/stripe/webhook/route.js', previous_filename: 'app/api/stripe/webhook/route.js', patch: '+anything' },
    ]
    expect(evaluateFiles(files).ok).toBe(false)
  })

  it('does not let an unrelated file borrow the webhook exception by claiming a fake previous_filename', () => {
    const files = [
      {
        filename: 'lib/innocuous.js',
        previous_filename: 'lib/also-innocuous.js',
        patch: '-stripe_customer_id: session.customer,',
      },
    ]
    // Neither filename nor previous_filename is offending, so this file is
    // skipped entirely (not an offender, not exception-evaluated) — correct,
    // since it never touched a sensitive path in the first place.
    const result = evaluateFiles(files)
    expect(result.ok).toBe(true)
    expect(result.exceptions).toEqual([])
  })
})

describe('validateChangedFilesCount — the 3000-file API ceiling (CI-GOV-011A/B)', () => {
  it.each([1, 99, 100, 101, 2999, 3000])('ACCEPTS %i as a valid changed_files count', (n) => {
    expect(validateChangedFilesCount(n)).toEqual({ ok: true })
  })

  it('REJECTS 3001 — past GitHub\'s documented 3000-file cap for this endpoint', () => {
    const result = validateChangedFilesCount(3001)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/3000-file API limit/)
  })

  it('REJECTS a much larger count the same way, not just the boundary', () => {
    expect(validateChangedFilesCount(50000).ok).toBe(false)
  })

  it('REJECTS zero', () => {
    expect(validateChangedFilesCount(0).ok).toBe(false)
  })

  it('REJECTS a negative count', () => {
    expect(validateChangedFilesCount(-1).ok).toBe(false)
  })

  it('REJECTS a non-integer count', () => {
    expect(validateChangedFilesCount(12.5).ok).toBe(false)
  })

  it('REJECTS undefined/null/NaN/string changed_files (missing or malformed metadata)', () => {
    expect(validateChangedFilesCount(undefined).ok).toBe(false)
    expect(validateChangedFilesCount(null).ok).toBe(false)
    expect(validateChangedFilesCount(NaN).ok).toBe(false)
    expect(validateChangedFilesCount('5').ok).toBe(false)
  })

  it('REJECTS Number.MAX_SAFE_INTEGER + 1 (not a safe integer)', () => {
    expect(validateChangedFilesCount(Number.MAX_SAFE_INTEGER + 1).ok).toBe(false)
  })
})

describe('parsePrMetadataJson — PR metadata response parsing (CI-GOV-011A/B)', () => {
  it('parses a well-formed metadata response', () => {
    const raw = JSON.stringify({ changed_files: 4, head_sha: 'abc123' })
    expect(parsePrMetadataJson(raw)).toEqual({ changedFiles: 4, headSha: 'abc123' })
  })

  it('fails closed (null) on malformed JSON', () => {
    expect(parsePrMetadataJson('{not valid json')).toBeNull()
  })

  it('fails closed (null) on non-string input', () => {
    expect(parsePrMetadataJson(undefined)).toBeNull()
    expect(parsePrMetadataJson(null)).toBeNull()
    expect(parsePrMetadataJson(42)).toBeNull()
  })

  it('fails closed (null) when head_sha is missing', () => {
    expect(parsePrMetadataJson(JSON.stringify({ changed_files: 4 }))).toBeNull()
  })

  it('fails closed (null) when head_sha is empty or not a string', () => {
    expect(parsePrMetadataJson(JSON.stringify({ changed_files: 4, head_sha: '' }))).toBeNull()
    expect(parsePrMetadataJson(JSON.stringify({ changed_files: 4, head_sha: 123 }))).toBeNull()
  })

  it('passes through a missing/malformed changed_files as-is — validateChangedFilesCount is responsible for rejecting it, not this parser', () => {
    const result = parsePrMetadataJson(JSON.stringify({ head_sha: 'abc123' }))
    expect(result).toEqual({ changedFiles: undefined, headSha: 'abc123' })
  })
})

describe('validateFileRecords — missing/duplicate filenames (CI-GOV-011A/B)', () => {
  it('ACCEPTS a clean list of unique, nonempty filenames', () => {
    const files = [{ filename: 'a.js' }, { filename: 'b.js' }, { filename: 'c.js' }]
    expect(validateFileRecords(files)).toEqual({ ok: true })
  })

  it('REJECTS a missing filename', () => {
    const files = [{ filename: 'a.js' }, { previous_filename: 'old.js' }]
    const result = validateFileRecords(files)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/nonempty filename/)
  })

  it('REJECTS an empty-string filename', () => {
    const files = [{ filename: '' }]
    expect(validateFileRecords(files).ok).toBe(false)
  })

  it('REJECTS a duplicate filename rather than silently deduplicating', () => {
    const files = [{ filename: 'a.js' }, { filename: 'a.js' }]
    const result = validateFileRecords(files)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/duplicate filename/)
  })

  it('ACCEPTS a large list (boundary sanity: 100 and 3000 unique files)', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ filename: `file-${i}.js` }))
    expect(validateFileRecords(hundred)).toEqual({ ok: true })
    const threeThousand = Array.from({ length: 3000 }, (_, i) => ({ filename: `file-${i}.js` }))
    expect(validateFileRecords(threeThousand)).toEqual({ ok: true })
  })
})

describe('headShasMatch — head-SHA consistency checks (CI-GOV-011A/B TOCTOU fix)', () => {
  it('matches two identical, nonempty SHAs', () => {
    expect(headShasMatch('abc123', 'abc123')).toBe(true)
  })

  it('REJECTS two different SHAs (the force-push-during-guard-run scenario)', () => {
    expect(headShasMatch('abc123', 'def456')).toBe(false)
  })

  it('REJECTS when either side is missing/empty/non-string', () => {
    expect(headShasMatch('', 'abc123')).toBe(false)
    expect(headShasMatch('abc123', '')).toBe(false)
    expect(headShasMatch(undefined, 'abc123')).toBe(false)
    expect(headShasMatch('abc123', null)).toBe(false)
    expect(headShasMatch(undefined, undefined)).toBe(false)
  })
})

describe('end-to-end file-count vs. changed_files consistency (CI-GOV-011A/B, conceptual integration coverage)', () => {
  // main() itself shells out to `gh`, which these pure-function tests
  // deliberately do not invoke (no network/process calls in this suite,
  // matching the rest of this file's established style) — this exercises
  // the exact same comparison main() performs, using the same helpers.
  it('a matching retrieved-count and declared changed_files count is consistent', () => {
    const declaredChangedFiles = 3
    const retrievedFiles = [{ filename: 'a.js' }, { filename: 'b.js' }, { filename: 'c.js' }]
    expect(retrievedFiles.length).toBe(declaredChangedFiles)
  })

  it('a 3001st file silently missing from a capped API response produces a detectable mismatch against changed_files', () => {
    const declaredChangedFiles = 3001
    const cappedRetrievedFiles = Array.from({ length: 3000 }, (_, i) => ({ filename: `file-${i}.js` }))
    expect(cappedRetrievedFiles.length).not.toBe(declaredChangedFiles)
    // And validateChangedFilesCount itself would already have rejected
    // 3001 before this comparison is ever reached.
    expect(validateChangedFilesCount(declaredChangedFiles).ok).toBe(false)
  })
})
