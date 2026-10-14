import { NextResponse } from 'next/server'

// Shared response helpers extracted from the legacy app/api/[[...path]]/route.js
// catch-all so the same exact CORS/behavior contract can be reused by the
// discrete App Router handlers that are gradually replacing it. Behavior is
// unchanged from the original inline helpers.

// Response helper for PUBLIC (token/slug-based) endpoints — advertises CORS
// so cross-origin clients (e.g. a future mobile app) can call them.
export const json = (payload, status = 200) => {
  const response = NextResponse.json(payload, { status })
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return response
}

// Response helper for SESSION_ONLY (cookie-based admin/owner) endpoints.
// These are only ever meant to be called same-origin by the SnapRooms
// frontend, so they must not advertise any cross-origin CORS support.
export const jsonPrivate = (payload, status = 200) => {
  return NextResponse.json(payload, { status })
}

export const formatZodError = (error) => {
  return error.issues?.map((issue) => issue.message).join(', ') || 'Invalid request payload'
}

export const isDatabaseUnavailableError = (error) => {
  return error?.code === 'P1001' || error?.code === 'P1002' || error?.code === 'P1008'
}

export const getSafeDbErrorMessage = (error, route) => {
  if (isDatabaseUnavailableError(error)) {
    const isLoginRoute = route === '/owner/login' || route === '/owner/session'
    return isLoginRoute
      ? 'Login temporarily unavailable. Please try again shortly.'
      : 'Service temporarily unavailable'
  }
  return 'Internal server error'
}

export const logDbError = (error, route, startTime) => {
  const durationMs = startTime ? Date.now() - startTime : null
  const safeMessage = error?.message
    ? String(error.message).replace(/\b\w+:\/\/[^\s]+/g, '[REDACTED]').substring(0, 200)
    : 'unknown'
  console.error(
    `[db-unavailable] route=${route} code=${error?.code || 'unknown'} name=${error?.name || 'unknown'} durationMs=${durationMs ?? 'unknown'} message=${safeMessage}`
  )
}

export const buildRateLimitResponse = (result) => {
  const response = json(
    {
      error: 'Too many requests. Please try again later.',
      code: 'rate_limited',
      retryAfter: result.retryAfter,
    },
    429
  )
  response.headers.set('Retry-After', String(result.retryAfter))
  return response
}

export const getManagementTokenFromRequest = (request) => {
  const auth = request.headers.get('authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

// NOTE: there is deliberately no shared "catch everything and return a JSON
// 500" helper here. The legacy catch-all's own top-level try/catch in
// handleRoute() almost never actually engages for route handler errors: every
// dispatch is `return someHandler(request, ...)` *without* awaiting it first,
// and per JS async-function semantics, returning a pending promise from an
// async function resolves/rejects that promise AFTER the function's own
// try/catch frame has already exited — so a handler's unhandled rejection
// propagates straight out of handleRoute() uncaught, not through its catch
// block. Each extracted route handler reproduces that same behavior by
// simply not adding a generic try/catch of its own (only the specific inline
// error handling that already existed inside each original handler). See
// app/api/uploads/init/route.js for the long-form version of this note.
