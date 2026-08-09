import {
  BlobUploadSessionInvariantError,
  claimBlobUploadSessionForToken,
  markBlobUploadSessionUploaded,
} from './blob-upload-session.js'

/**
 * Constraints:
 * - Does not import getPrismaClient().
 * - Does not create PrismaClient.
 * - Does not import route.js or client components.
 * - Does not make network calls.
 * - Does not import @vercel/blob.
 * - Does not read environment variables.
 * - Does not log URLs, sessionIds, payloads, or full tokens.
 */

// ─── Error class ─────────────────────────────────────────────────────────────

export class BlobUploadTokenRequestError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} publicMessage
   */
  constructor(code, status, publicMessage) {
    super(`BlobUploadTokenRequestError: ${code}`)
    this.name = 'BlobUploadTokenRequestError'
    this.code = code
    this.status = status
    this.publicMessage = publicMessage
  }
}

const TOKEN_ERRORS = {
  invalid_payload: [400, 'Invalid upload request'],
  invalid_callback_url: [400, 'Invalid Blob upload request.'],
  pathname_mismatch: [400, 'Upload path does not match session'],
  invalid_status: [409, 'Upload session is not in the expected state'],
  session_not_found: [404, 'Upload session not found'],
  session_expired: [410, 'Upload session has expired'],
  event_deleted: [410, 'Associated event no longer exists'],
  database_unavailable: [503, 'Upload service is temporarily unavailable.'],
}

function makeTokenError(code) {
  const [status, publicMessage] = TOKEN_ERRORS[code] ?? [400, 'Invalid upload request']
  return new BlobUploadTokenRequestError(code, status, publicMessage)
}

// ─── Canonical session payload ────────────────────────────────────────────────

/**
 * Parses a JSON string that must be exactly { "sessionId": "<string>" }.
 *
 * Rejects:
 * - non-string value
 * - malformed JSON
 * - non-plain-object result
 * - missing sessionId
 * - extra keys
 * - sessionId not a string
 * - sessionId shorter than 8 or longer than 120 characters
 */
function parseCanonicalSessionPayload(value) {
  if (typeof value !== 'string') {
    throw makeTokenError('invalid_payload')
  }

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw makeTokenError('invalid_payload')
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw makeTokenError('invalid_payload')
  }

  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'sessionId') {
    throw makeTokenError('invalid_payload')
  }

  const { sessionId } = parsed
  if (typeof sessionId !== 'string') {
    throw makeTokenError('invalid_payload')
  }

  const trimmed = sessionId.trim()
  if (trimmed.length < 8 || trimmed.length > 120) {
    throw makeTokenError('invalid_payload')
  }

  return { sessionId: trimmed }
}

// ─── isBlobUploadCompletedBody ────────────────────────────────────────────────

/**
 * Returns true only when body is a plain object with type === 'blob.upload-completed'.
 * Arrays, null, strings, and other types return false.
 */
export function isBlobUploadCompletedBody(body) {
  return (
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    body.type === 'blob.upload-completed'
  )
}

// ─── getBlobUploadRequestKind ─────────────────────────────────────────────────

/**
 * Strictly classifies a parsed request body as 'token' or 'callback'.
 *
 * Returns:
 *   'token'    — body.type === 'blob.generate-client-token'
 *   'callback' — body.type === 'blob.upload-completed'
 *
 * Throws BlobUploadTokenRequestError(invalid_payload) for:
 *   - null, array, string
 *   - plain object without type
 *   - unknown type value
 *
 * @param {unknown} body
 * @returns {'token'|'callback'}
 */
export function getBlobUploadRequestKind(body) {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw makeTokenError('invalid_payload')
  }

  if (body.type === 'blob.generate-client-token') return 'token'
  if (body.type === 'blob.upload-completed') return 'callback'

  throw makeTokenError('invalid_payload')
}

// ─── validateBlobUploadCallbackUrl ───────────────────────────────────────────

/**
 * For blob.generate-client-token requests only, validates that the callbackUrl
 * embedded in the body matches the server's own origin and exactly the path
 * /api/uploads/blob.
 *
 * This prevents a client from supplying an attacker-controlled callbackUrl
 * that would redirect the Vercel upload-completed callback elsewhere.
 *
 * Does nothing for blob.upload-completed or other body types.
 *
 * @param {unknown} body - the parsed request body
 * @param {string} requestUrl - the full URL of the incoming request (e.g. request.url)
 */
export function validateBlobUploadCallbackUrl(body, requestUrl) {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    body.type !== 'blob.generate-client-token'
  ) {
    return
  }

  const payload = body.payload
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw makeTokenError('invalid_callback_url')
  }

  const { callbackUrl } = payload
  if (typeof callbackUrl !== 'string') {
    throw makeTokenError('invalid_callback_url')
  }

  let parsed
  try {
    parsed = new URL(callbackUrl)
  } catch {
    throw makeTokenError('invalid_callback_url')
  }

  if (parsed.username !== '') throw makeTokenError('invalid_callback_url')
  if (parsed.password !== '') throw makeTokenError('invalid_callback_url')
  if (parsed.search !== '') throw makeTokenError('invalid_callback_url')
  if (parsed.hash !== '') throw makeTokenError('invalid_callback_url')

  // Derive the expected URL from the server's own request URL — never trust Host header manually
  let expected
  try {
    expected = new URL('/api/uploads/blob', requestUrl)
  } catch {
    throw makeTokenError('invalid_callback_url')
  }

  if (parsed.origin !== expected.origin) throw makeTokenError('invalid_callback_url')
  if (parsed.pathname !== expected.pathname) throw makeTokenError('invalid_callback_url')
}

// ─── createServerBoundBlobUploadCallbacks ────────────────────────────────────

/**
 * @param {{
 *   prisma: object,
 *   now?: () => Date,
 *   logger?: { warn?: Function, error?: Function },
 * }} options
 */
export function createServerBoundBlobUploadCallbacks({
  prisma,
  now = () => new Date(),
  logger,
}) {
  if (
    !prisma ||
    typeof prisma.blobUploadSession !== 'object' ||
    prisma.blobUploadSession === null
  ) {
    throw new Error(
      'createServerBoundBlobUploadCallbacks: prisma.blobUploadSession delegate is required',
    )
  }

  const logWarn = (msg) => {
    if (typeof logger?.warn === 'function') {
      logger.warn(msg)
    }
  }

  const logError = (msg) => {
    if (typeof logger?.error === 'function') {
      logger.error(msg)
    }
  }

  // ── onBeforeGenerateToken ──────────────────────────────────────────────────

  /**
   * Called by @vercel/blob handleUpload before generating the client token.
   *
   * @param {string} pathname - destination path from the Vercel SDK
   * @param {string|null} clientPayload - must be JSON { sessionId: "..." }
   * @param {boolean} _multipart - unused
   */
  const onBeforeGenerateToken = async (pathname, clientPayload, _multipart) => {
    // 1. Parse and validate the canonical session payload
    const { sessionId } = parseCanonicalSessionPayload(clientPayload)

    // 2. Claim the session for token issuance (transitions PENDING → TOKEN_ISSUED)
    const result = await claimBlobUploadSessionForToken(prisma, {
      sessionId,
      pathname,
      now: now(),
    })

    if (!result.ok) {
      const reason = result.reason
      switch (reason) {
        case 'not_found':
          throw makeTokenError('session_not_found')
        case 'expired':
          throw makeTokenError('session_expired')
        case 'event_deleted':
          throw makeTokenError('event_deleted')
        case 'pathname_mismatch':
          throw makeTokenError('pathname_mismatch')
        case 'invalid_status':
          throw makeTokenError('invalid_status')
        default:
          throw makeTokenError('invalid_payload')
      }
    }

    const session = result.session

    // 3. Defense-in-depth invariant checks on the returned session
    if (
      typeof session.mimeType !== 'string' ||
      session.mimeType.trim() === ''
    ) {
      throw makeTokenError('invalid_status')
    }
    if (
      typeof session.expectedSize !== 'number' ||
      !Number.isInteger(session.expectedSize) ||
      session.expectedSize <= 0
    ) {
      throw makeTokenError('invalid_status')
    }
    if (
      !(session.expiresAt instanceof Date) ||
      isNaN(session.expiresAt.getTime())
    ) {
      throw makeTokenError('invalid_status')
    }
    if (session.expectedPathname !== pathname) {
      throw makeTokenError('pathname_mismatch')
    }

    // 4. Return only the properties supported by the installed @vercel/blob version.
    //    validUntil is a Unix timestamp in milliseconds (number).
    return {
      allowedContentTypes: [session.mimeType],
      maximumSizeInBytes: session.expectedSize,
      validUntil: session.expiresAt.getTime(),
      addRandomSuffix: false,
      allowOverwrite: false,
      tokenPayload: JSON.stringify({ sessionId: session.id }),
    }
  }

  // ── onUploadCompleted ──────────────────────────────────────────────────────

  /**
   * Called by @vercel/blob handleUpload after the Vercel signature is verified.
   *
   * @param {{ blob: object, tokenPayload?: string|null }} payload
   */
  const onUploadCompleted = async (payload) => {
    // 1. Extract fields using the verified structure of UploadCompletedEvent.payload
    const { tokenPayload, blob } = payload ?? {}

    // 2. Parse the canonical session payload (tokenPayload was written by us in onBeforeGenerateToken)
    let sessionId
    try {
      ;({ sessionId } = parseCanonicalSessionPayload(tokenPayload))
    } catch {
      logWarn('[blob-upload-token] completed: invalid_payload (permanent)')
      return { handled: false, reason: 'invalid_payload' }
    }

    // 3. Validate blob shape
    if (
      blob === null ||
      typeof blob !== 'object' ||
      Array.isArray(blob) ||
      typeof blob.pathname !== 'string' ||
      blob.pathname.trim() === '' ||
      typeof blob.url !== 'string' ||
      blob.url.trim() === ''
    ) {
      logWarn('[blob-upload-token] completed: malformed_blob (permanent)')
      return { handled: false, reason: 'malformed_blob' }
    }

    // 4. Mark the session as uploaded (transitions TOKEN_ISSUED → UPLOADED)
    let result
    try {
      result = await markBlobUploadSessionUploaded(prisma, {
        sessionId,
        pathname: blob.pathname,
        blobUrl: blob.url,
        uploadedAt: now(),
      })
    } catch (error) {
      if (error instanceof BlobUploadSessionInvariantError) {
        // Permanent invariant violation — do not retry
        logError('[blob-upload-token] completed: invariant_error (permanent)')
        return { handled: false, reason: 'invariant_error' }
      }
      // Unknown or DB error — rethrow so Vercel can retry
      throw error
    }

    if (result.ok) {
      return { handled: true }
    }

    // Permanent non-ok reasons — log a static code, do not log dynamic values
    const permanentReasons = [
      'not_found',
      'pathname_mismatch',
      'blob_url_conflict',
      'invalid_status',
    ]

    if (permanentReasons.includes(result.reason)) {
      logWarn(`[blob-upload-token] completed: ${result.reason} (permanent)`)
      return { handled: false, reason: result.reason }
    }

    // Any other reason: rethrow to allow Vercel retry
    throw new Error(`[blob-upload-token] unexpected markBlobUploadSessionUploaded reason`)
  }

  return { onBeforeGenerateToken, onUploadCompleted }
}

// ─── createLazyServerBoundBlobUploadCallbacks ─────────────────────────────────

/**
 * Like createServerBoundBlobUploadCallbacks but resolves Prisma lazily.
 *
 * getPrisma is never called during construction — only when handleUpload
 * invokes onBeforeGenerateToken or onUploadCompleted. Within a single
 * request, the Promise is memoized so getPrisma is called at most once.
 *
 * If the resolved Prisma is missing or lacks blobUploadSession, throws
 * BlobUploadTokenRequestError(database_unavailable, 503).
 *
 * @param {{
 *   getPrisma: () => Promise<object|null>,
 *   now?: () => Date,
 *   logger?: { warn?: Function, error?: Function },
 * }} options
 */
export function createLazyServerBoundBlobUploadCallbacks({
  getPrisma,
  now = () => new Date(),
  logger,
}) {
  if (typeof getPrisma !== 'function') {
    throw new Error('createLazyServerBoundBlobUploadCallbacks: getPrisma must be a function')
  }

  // Memoize the Promise so Prisma is resolved only once per request instance
  let prismaPromise = null

  async function resolveCallbacks() {
    if (prismaPromise === null) {
      prismaPromise = getPrisma()
    }
    const prisma = await prismaPromise

    if (
      !prisma ||
      typeof prisma.blobUploadSession !== 'object' ||
      prisma.blobUploadSession === null
    ) {
      throw makeTokenError('database_unavailable')
    }

    return createServerBoundBlobUploadCallbacks({ prisma, now, logger })
  }

  const onBeforeGenerateToken = async (pathname, clientPayload, multipart) => {
    const callbacks = await resolveCallbacks()
    return callbacks.onBeforeGenerateToken(pathname, clientPayload, multipart)
  }

  const onUploadCompleted = async (payload) => {
    const callbacks = await resolveCallbacks()
    return callbacks.onUploadCompleted(payload)
  }

  return { onBeforeGenerateToken, onUploadCompleted }
}
