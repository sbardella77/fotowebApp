/**
 * Server-side PostHog HogQL query transport.
 *
 * This is the ONLY place in the app allowed to call PostHog's privileged
 * Query API. It never accepts caller-supplied SQL — every call site passes a
 * fixed HogQL string built entirely from server-controlled constants (see
 * lib/server/admin-analytics-posthog.js). Credentials are read from
 * server-only env vars and never returned, logged, or embedded in a
 * response.
 *
 * Query host: PostHog's privileged/query API host (`us.posthog.com` /
 * `eu.posthog.com`) is a DIFFERENT host from the public ingestion host used
 * by the client SDK (`NEXT_PUBLIC_POSTHOG_HOST`, typically
 * `*.i.posthog.com` or the legacy `app.posthog.com` alias) — see
 * https://posthog.com/docs/api. Do not reuse NEXT_PUBLIC_POSTHOG_HOST here.
 */

const DEFAULT_API_HOST = 'https://us.posthog.com'
const QUERY_TIMEOUT_MS = 8000

export const POSTHOG_ERROR = {
  NOT_CONFIGURED: 'POSTHOG_NOT_CONFIGURED',
  TIMEOUT: 'POSTHOG_TIMEOUT',
  AUTH_FAILED: 'POSTHOG_AUTH_FAILED',
  RATE_LIMITED: 'POSTHOG_RATE_LIMITED',
  QUERY_FAILED: 'POSTHOG_QUERY_FAILED',
  INVALID_RESPONSE: 'POSTHOG_INVALID_RESPONSE',
}

export class PostHogQueryError extends Error {
  constructor(category, message) {
    super(message)
    this.name = 'PostHogQueryError'
    this.category = category
  }
}

function getConfig() {
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY
  const projectId = process.env.POSTHOG_PROJECT_ID
  const apiHost = process.env.POSTHOG_API_HOST || DEFAULT_API_HOST
  if (!apiKey || !projectId) return null
  return { apiKey, projectId, apiHost }
}

export function isPostHogQueryConfigured() {
  return getConfig() !== null
}

/**
 * Run one fixed HogQL query and return its raw `results` rows.
 *
 * @param {string} hogql - A HogQL SELECT statement. Callers must build this
 *   from fixed string literals / server-derived timestamps only — never
 *   from raw request input. See lib/server/admin-analytics-posthog.js.
 * @param {string} queryName - A short label used only for logs/errors, e.g.
 *   'marketing_visitors'. Never sensitive.
 */
export async function runHogQLQuery(hogql, queryName) {
  const config = getConfig()
  if (!config) {
    throw new PostHogQueryError(POSTHOG_ERROR.NOT_CONFIGURED, 'PostHog query credentials are not configured')
  }

  const url = `${config.apiHost}/api/projects/${config.projectId}/query/`
  const startedAt = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        query: { kind: 'HogQLQuery', query: hogql },
        name: queryName,
      }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      console.error(`[posthog-query] timeout query=${queryName} durationMs=${durationMs}`)
      throw new PostHogQueryError(POSTHOG_ERROR.TIMEOUT, 'PostHog query timed out')
    }
    console.error(`[posthog-query] network_error query=${queryName} durationMs=${durationMs} message=${error?.message}`)
    throw new PostHogQueryError(POSTHOG_ERROR.QUERY_FAILED, 'PostHog query request failed')
  }

  const durationMs = Date.now() - startedAt

  if (response.status === 401 || response.status === 403) {
    console.error(`[posthog-query] auth_failed query=${queryName} status=${response.status} durationMs=${durationMs}`)
    throw new PostHogQueryError(POSTHOG_ERROR.AUTH_FAILED, 'PostHog rejected query credentials')
  }

  if (response.status === 429) {
    console.error(`[posthog-query] rate_limited query=${queryName} durationMs=${durationMs}`)
    throw new PostHogQueryError(POSTHOG_ERROR.RATE_LIMITED, 'PostHog query rate limit exceeded')
  }

  if (!response.ok) {
    console.error(`[posthog-query] query_failed query=${queryName} status=${response.status} durationMs=${durationMs}`)
    throw new PostHogQueryError(POSTHOG_ERROR.QUERY_FAILED, `PostHog query failed with status ${response.status}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    console.error(`[posthog-query] invalid_json query=${queryName} durationMs=${durationMs}`)
    throw new PostHogQueryError(POSTHOG_ERROR.INVALID_RESPONSE, 'PostHog returned a non-JSON response')
  }

  if (!Array.isArray(body?.results)) {
    console.error(`[posthog-query] invalid_shape query=${queryName} durationMs=${durationMs}`)
    throw new PostHogQueryError(POSTHOG_ERROR.INVALID_RESPONSE, 'PostHog response did not contain a results array')
  }

  console.log(`[posthog-query] ok query=${queryName} durationMs=${durationMs} rows=${body.results.length}`)
  return body.results
}
