import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// STEP 7.13a — Guest room-photo upload: HTTP 429 from every fetch-controlled
// stage (init, complete [both Vercel-blob and local/chunked paths], chunk)
// must immediately stop the whole-file retry loop, instead of being retried
// up to 3x (see STEP 7.13 §C for the amplification this closes).
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
// is a pure function and needs no source parsing at all.

const ROOM = readFileSync(resolve(import.meta.dirname, '..', 'components/room-page-client.jsx'), 'utf8')

function extractUploadSingleFile(source) {
  const startMarker = 'const uploadSingleFile = async'
  const endMarker = 'const MAX_FILE_SIZE ='
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

const INIT_BLOCK = sliceAfter(FN, "if (!initResponse.ok) {")
const VERCEL_COMPLETE_BLOCK = sliceAfter(FN, "if (!completeResponse.ok) {")
const CHUNK_BLOCK = sliceAfter(FN, "if (!chunkResponse.ok) {")
// The local/chunked complete block is the SECOND "if (!completeResponse.ok)"
// occurrence — find it explicitly.
function secondOccurrenceBlock(source, marker, length = 700) {
  const first = source.indexOf(marker)
  expect(first).toBeGreaterThan(-1)
  const second = source.indexOf(marker, first + 1)
  expect(second).toBeGreaterThan(first)
  return source.slice(second, second + length)
}
const LOCAL_COMPLETE_BLOCK = secondOccurrenceBlock(FN, "if (!completeResponse.ok) {")

describe('Guest upload — helper import', () => {
  it('imports isRetryableUploadHttpStatus from lib/upload-utils', () => {
    expect(ROOM).toContain("import { runWithConcurrency, isRetryableUploadHttpStatus } from '@/lib/upload-utils'")
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
})

describe('Guest upload — chunk 429 classification', () => {
  it('classifies by chunkResponse.status via the helper before throwing (no photo_count concept at this stage)', () => {
    expect(CHUNK_BLOCK).toContain('const err = new Error(chunkPayload.error || t.chunkFailed)')
    expect(CHUNK_BLOCK).toContain('if (!isRetryableUploadHttpStatus(chunkResponse.status)) err.nonRetryable = true')
  })
})

describe('Guest upload — retry loop mechanics are untouched', () => {
  it('still attempts exactly 3 times with the existing linear backoff', () => {
    expect(FN).toContain('for (let attempt = 0; attempt < 3; attempt++)')
    expect(FN).toContain('await new Promise((r) => setTimeout(r, 800 * attempt))')
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
})

describe('Guest upload — generic transient failures remain retryable (unchanged)', () => {
  it('every nonRetryable assignment is either the pre-existing unconditional photo_count case or the new conditional 429 case — nothing else sets it', () => {
    const lines = FN.split('\n').filter((l) => l.includes('nonRetryable = true'))
    expect(lines.length).toBe(7)

    const unconditional = lines.filter((l) => l.trim() === 'err.nonRetryable = true')
    const conditional = lines.filter((l) => l.includes('if (!isRetryableUploadHttpStatus('))

    // 3 pre-existing photo_count blocks (init, vercel-complete, local-complete).
    expect(unconditional.length).toBe(3)
    // 4 new conditional 429-classification sites (init, vercel-complete, local-complete, chunk).
    expect(conditional.length).toBe(4)
    expect(unconditional.length + conditional.length).toBe(lines.length)
  })
})
