import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// STEP 7.13a — Guest room-photo upload: HTTP 429 from every fetch-controlled
// stage (init, complete [both Vercel-blob and local/chunked paths], chunk)
// must immediately stop the whole-file retry loop, instead of being retried
// up to MAX_UPLOAD_ATTEMPTS times (see STEP 7.13 §C for the amplification
// this closes).
//
// STEP 7.15g.1 extends the same mechanism to HTTP 422 (deterministic
// source-content rejection from the STEP 7.15g validator): since all four
// call sites below funnel through the single shared
// isRetryableUploadHttpStatus(status) classifier before setting
// err.nonRetryable, and that classifier is now proven (tests/upload-
// utils.test.js) to return false for 422 exactly as it does for 429, no
// wiring change was needed here — the same structural proof that made 429
// stop the loop after one attempt now also covers 422. This file adds
// explicit 422-labeled assertions alongside the existing ones so the two
// statuses are never allowed to drift apart silently.
//
// Roadmap item 7 (upload resilience on flaky networks) restructured
// uploadSingleFile: the local/chunked path's session is now created once
// and reused across outer retry attempts (so a network blip resumes from
// the next unsent chunk instead of re-uploading everything), each chunk
// gets its own short retry before propagating to the outer loop, and the
// outer loop waits for navigator.onLine before each attempt. The
// classification contract this file proves (which statuses are retryable,
// where photo_count always wins, the single isRetryableUploadHttpStatus
// seam) is explicitly unchanged by that restructuring — only the ordering
// of the four fetch-controlled blocks in source and the attempt
// count/backoff formula moved, both updated below.
//
// The blob-token-generation request (issued internally by @vercel/blob's
// upload() client SDK) is explicitly OUT of scope for this STEP — its
// failure surfaces as a bare BlobError with no HTTP status preserved, so it
// cannot be classified by status at this app boundary.
// GUEST_BLOB_TOKEN_429_RETRY_AMPLIFICATION remains open.
//
// There is no React-rendering test harness in this project (no
// @testing-library/react, no jsdom config) — component-level assertions
// here follow the same source-contract idiom already established in
// tests/blob-upload-client-contract.test.js. The actual status -> boolean
// classification logic is behavior-tested directly in
// tests/upload-utils.test.js (isRetryableUploadHttpStatus), since that part
// is a pure function and needs no source parsing at all. Combined, these two
// files are the full proof that a 422 (like a 429) reaches exactly one
// attempt: the pure function proves the classification is false, and this
// file proves every call site reaches that classifier and that the loop's
// break-on-nonRetryable mechanics are untouched — without needing to
// actually execute the component, which this repo has no harness for.

const ROOM = readFileSync(resolve(import.meta.dirname, '..', 'components/room-page-client.jsx'), 'utf8')

function extractUploadSingleFile(source) {
  const startMarker = 'const uploadSingleFile = async'
  const endMarker = 'const retryUpload = (localId) =>'
  const startIdx = source.indexOf(startMarker)
  const endIdx = source.indexOf(endMarker, startIdx)
  expect(startIdx).toBeGreaterThan(-1)
  expect(endIdx).toBeGreaterThan(startIdx)
  return source.slice(startIdx, endIdx)
}

const FN = extractUploadSingleFile(ROOM)

// Isolate the four fetch-controlled error-handling blocks by their distinct
// response variable names / endpoints, so assertions can't accidentally
// match the wrong block.
function sliceAfter(source, marker, length = 700) {
  const idx = source.indexOf(marker)
  expect(idx).toBeGreaterThan(-1)
  return source.slice(idx, idx + length)
}

const INIT_BLOCK = sliceAfter(FN, 'if (!initResponse.ok) {')
const CHUNK_BLOCK = sliceAfter(FN, 'if (!chunkResponse.ok) {')
// uploadRemainingLocalChunks (the local/chunked path's helper) is now
// defined BEFORE the outer attempt loop so it can close over the
// chunkSession/nextChunkIndex resume state — so its own
// "if (!completeResponse.ok)" block is the FIRST occurrence in FN, and the
// Vercel-blob path's (inside the loop) is the SECOND. This is the opposite
// order from before the roadmap-item-7 restructuring.
function occurrenceBlock(source, marker, which, length = 700) {
  const first = source.indexOf(marker)
  expect(first).toBeGreaterThan(-1)
  if (which === 1) return source.slice(first, first + length)
  const second = source.indexOf(marker, first + 1)
  expect(second).toBeGreaterThan(first)
  return source.slice(second, second + length)
}
const LOCAL_COMPLETE_BLOCK = occurrenceBlock(FN, 'if (!completeResponse.ok) {', 1)
const VERCEL_COMPLETE_BLOCK = occurrenceBlock(FN, 'if (!completeResponse.ok) {', 2)

describe('Guest upload — helper import', () => {
  it('imports isRetryableUploadHttpStatus and waitForOnline from lib/upload-utils', () => {
    expect(ROOM).toContain("import { runWithConcurrency, isRetryableUploadHttpStatus, waitForOnline } from '@/lib/upload-utils'")
  })
})

describe('Guest upload — init 429 classification', () => {
  it('photo_count still takes priority and is unconditionally nonRetryable', () => {
    expect(INIT_BLOCK).toContain("if (initPayload.limit === 'photo_count') {")
    const photoCountIdx = INIT_BLOCK.indexOf("if (initPayload.limit === 'photo_count') {")
    const photoCountBlock = INIT_BLOCK.slice(photoCountIdx, photoCountIdx + 300)
    expect(photoCountBlock).toContain('setPhotoLimitError(initPayload)')
    expect(photoCountBlock).toContain('t.roomPhotoLimitReached')
    expect(photoCountBlock).toContain('err.nonRetryable = true')
  })

  it('the generic (non-photo_count) failure path classifies by initResponse.status via the helper before throwing', () => {
    expect(INIT_BLOCK).toContain('const err = new Error(initPayload.error || t.uploadError)')
    expect(INIT_BLOCK).toContain('if (!isRetryableUploadHttpStatus(initResponse.status)) err.nonRetryable = true')
    const errIdx = INIT_BLOCK.indexOf('const err = new Error(initPayload.error || t.uploadError)')
    const classifyIdx = INIT_BLOCK.indexOf('if (!isRetryableUploadHttpStatus(initResponse.status))')
    const throwIdx = INIT_BLOCK.indexOf('throw err', classifyIdx)
    expect(errIdx).toBeLessThan(classifyIdx)
    expect(classifyIdx).toBeLessThan(throwIdx)
  })

  it('preserves the existing error-message construction (payload.error || t.uploadError) — no new copy introduced', () => {
    expect(INIT_BLOCK).toContain('initPayload.error || t.uploadError')
  })
})

describe('Guest upload — complete (Vercel-blob path) 429 classification', () => {
  it('photo_count still takes priority and is unconditionally nonRetryable', () => {
    expect(VERCEL_COMPLETE_BLOCK).toContain("if (completePayload.limit === 'photo_count') {")
    const idx = VERCEL_COMPLETE_BLOCK.indexOf("if (completePayload.limit === 'photo_count') {")
    const block = VERCEL_COMPLETE_BLOCK.slice(idx, idx + 300)
    expect(block).toContain('setPhotoLimitError(completePayload)')
    expect(block).toContain('t.roomPhotoLimitReached')
    expect(block).toContain('err.nonRetryable = true')
  })

  it('the generic failure path classifies by completeResponse.status via the helper before throwing', () => {
    expect(VERCEL_COMPLETE_BLOCK).toContain('const err = new Error(completePayload.error || t.uploadError)')
    expect(VERCEL_COMPLETE_BLOCK).toContain('if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true')
  })
})

describe('Guest upload — complete (local/chunked path) 429 classification', () => {
  it('photo_count still takes priority and is unconditionally nonRetryable', () => {
    expect(LOCAL_COMPLETE_BLOCK).toContain("if (completePayload.limit === 'photo_count') {")
    const idx = LOCAL_COMPLETE_BLOCK.indexOf("if (completePayload.limit === 'photo_count') {")
    const block = LOCAL_COMPLETE_BLOCK.slice(idx, idx + 300)
    expect(block).toContain('setPhotoLimitError(completePayload)')
    expect(block).toContain('err.nonRetryable = true')
  })

  it('the generic failure path classifies by completeResponse.status via the helper before throwing', () => {
    expect(LOCAL_COMPLETE_BLOCK).toContain('const err = new Error(completePayload.error || t.uploadError)')
    expect(LOCAL_COMPLETE_BLOCK).toContain('if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true')
  })

  it('a 403 at complete time marks the session invalid (forces a fresh init on the next attempt)', () => {
    expect(LOCAL_COMPLETE_BLOCK).toContain('if (completeResponse.status === 403) err.sessionInvalid = true')
  })
})

describe('Guest upload — chunk 429 classification', () => {
  it('classifies by chunkResponse.status via the helper before throwing (no photo_count concept at this stage)', () => {
    expect(CHUNK_BLOCK).toContain('const err = new Error(chunkPayload.error || t.chunkFailed)')
    expect(CHUNK_BLOCK).toContain('if (!isRetryableUploadHttpStatus(chunkResponse.status)) err.nonRetryable = true')
  })

  it('a 400 or 403 marks the session invalid, not just nonRetryable — forces resume via a fresh init instead of hammering a dead session', () => {
    expect(CHUNK_BLOCK).toContain("if (chunkResponse.status === 400 || chunkResponse.status === 403) {")
    expect(CHUNK_BLOCK).toContain('err.sessionInvalid = true')
  })
})

describe('Guest upload — retry loop mechanics', () => {
  it('attempts up to MAX_UPLOAD_ATTEMPTS (5) times with capped exponential backoff', () => {
    expect(ROOM).toContain('const MAX_UPLOAD_ATTEMPTS = 5')
    expect(FN).toContain('for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS; attempt++)')
    expect(FN).toContain('await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)))')
  })

  it('isRetryable() still only consults error.nonRetryable — no new global bypass', () => {
    const idx = FN.indexOf('const isRetryable = (error) => {')
    expect(idx).toBeGreaterThan(-1)
    const block = FN.slice(idx, idx + 120)
    expect(block).toContain('if (error.nonRetryable) return false')
    expect(block).toContain('return true')
  })

  it('the catch block still breaks on nonRetryable and otherwise lets the loop continue', () => {
    expect(FN).toContain('if (!isRetryable(error)) break')
  })

  it('exactly four fetch-controlled error-throwing sites reference isRetryableUploadHttpStatus — no more, no less', () => {
    const matches = FN.match(/isRetryableUploadHttpStatus\(/g) || []
    expect(matches.length).toBe(4)
  })

  it('the @vercel/blob upload() client-token call itself is untouched — no status inspection added there', () => {
    const uploadCallIdx = FN.indexOf('await upload(')
    expect(uploadCallIdx).toBeGreaterThan(-1)
    const uploadCallBlock = FN.slice(uploadCallIdx, uploadCallIdx + 500)
    expect(uploadCallBlock).not.toContain('isRetryableUploadHttpStatus')
  })

  it('waits for navigator.onLine before each outer attempt and before each chunk attempt', () => {
    const matches = FN.match(/await waitForOnline\(\)/g) || []
    expect(matches.length).toBe(2)
  })

  it('the local-chunk path resumes from nextChunkIndex instead of restarting at 0 on an outer retry', () => {
    expect(FN).toContain('for (let chunkIndex = nextChunkIndex; chunkIndex < totalChunks; chunkIndex += 1)')
    expect(FN).toContain('if (chunkSession) {')
  })
})

describe('Guest upload — HTTP 422 (STEP 7.15g.1) reaches the same shared classifier as 429', () => {
  it('all four call sites still route through isRetryableUploadHttpStatus — the single source of the 422 verdict', () => {
    // Deliberately re-asserts (rather than assumes) that no call site grew a
    // second, parallel classification path for 422 specifically — status-
    // based non-retryable classification must have exactly one seam.
    expect(INIT_BLOCK).toContain('if (!isRetryableUploadHttpStatus(initResponse.status)) err.nonRetryable = true')
    expect(VERCEL_COMPLETE_BLOCK).toContain('if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true')
    expect(LOCAL_COMPLETE_BLOCK).toContain('if (!isRetryableUploadHttpStatus(completeResponse.status)) err.nonRetryable = true')
    expect(CHUNK_BLOCK).toContain('if (!isRetryableUploadHttpStatus(chunkResponse.status)) err.nonRetryable = true')
  })

  it('merge-blocking: no 422-specific branch bypasses the shared classifier (e.g. no hardcoded "=== 422" check anywhere in the retry function)', () => {
    expect(FN).not.toContain('=== 422')
    expect(FN).not.toContain('422 ===')
  })
})

describe('Guest upload — generic transient failures remain retryable (unchanged)', () => {
  it('every nonRetryable assignment is either the pre-existing unconditional photo_count case or the conditional status-classified case — nothing else sets it', () => {
    const lines = FN.split('\n').filter((l) => l.includes('nonRetryable = true'))
    expect(lines.length).toBe(7)

    const unconditional = lines.filter((l) => l.trim() === 'err.nonRetryable = true')
    const conditional = lines.filter((l) => l.includes('if (!isRetryableUploadHttpStatus('))

    // 3 pre-existing photo_count blocks (init, vercel-complete, local-complete).
    expect(unconditional.length).toBe(3)
    // 4 conditional status-classification sites (init, vercel-complete, local-complete, chunk).
    expect(conditional.length).toBe(4)
    expect(unconditional.length + conditional.length).toBe(lines.length)
  })
})
