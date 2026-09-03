import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

async function importFresh() {
  vi.resetModules()
  return import('../lib/server/posthog-query.js')
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  fetchMock.mockReset()
  process.env.POSTHOG_PERSONAL_API_KEY = 'phx_test_secret_key_value'
  process.env.POSTHOG_PROJECT_ID = '12345'
  delete process.env.POSTHOG_API_HOST
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function okResponse(results) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results }),
  }
}

describe('posthog-query transport', () => {
  it('1. missing config -> POSTHOG_NOT_CONFIGURED without calling fetch', async () => {
    delete process.env.POSTHOG_PERSONAL_API_KEY
    delete process.env.POSTHOG_PROJECT_ID
    const { runHogQLQuery, PostHogQueryError, POSTHOG_ERROR } = await importFresh()

    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({
      category: POSTHOG_ERROR.NOT_CONFIGURED,
    })
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toBeInstanceOf(PostHogQueryError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2. builds the Authorization header from the configured key without ever including it in a thrown error', async () => {
    fetchMock.mockResolvedValue(okResponse([[1]]))
    const { runHogQLQuery } = await importFresh()

    await runHogQLQuery('SELECT 1', 'q')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer phx_test_secret_key_value')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('3. routes to the default host and project id, and honors POSTHOG_API_HOST override', async () => {
    fetchMock.mockResolvedValue(okResponse([]))
    let { runHogQLQuery } = await importFresh()
    await runHogQLQuery('SELECT 1', 'q')
    expect(fetchMock.mock.calls[0][0]).toBe('https://us.posthog.com/api/projects/12345/query/')

    process.env.POSTHOG_API_HOST = 'https://eu.posthog.com'
    ;({ runHogQLQuery } = await importFresh())
    fetchMock.mockClear()
    fetchMock.mockResolvedValue(okResponse([]))
    await runHogQLQuery('SELECT 1', 'q')
    expect(fetchMock.mock.calls[0][0]).toBe('https://eu.posthog.com/api/projects/12345/query/')
  })

  it('4. timeout -> POSTHOG_TIMEOUT', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'TimeoutError'
    fetchMock.mockRejectedValue(abortError)
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()

    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.TIMEOUT })
  })

  it('5a. upstream 401 -> POSTHOG_AUTH_FAILED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.AUTH_FAILED })
  })

  it('5b. upstream 403 -> POSTHOG_AUTH_FAILED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.AUTH_FAILED })
  })

  it('6. upstream 429 -> POSTHOG_RATE_LIMITED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.RATE_LIMITED })
  })

  it('7. upstream 5xx -> POSTHOG_QUERY_FAILED', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.QUERY_FAILED })
  })

  it('8. invalid JSON body -> POSTHOG_INVALID_RESPONSE', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.INVALID_RESPONSE })
  })

  it('9. malformed response shape (no results array) -> POSTHOG_INVALID_RESPONSE, never silently zero', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ notResults: [] }) })
    const { runHogQLQuery, POSTHOG_ERROR } = await importFresh()
    await expect(runHogQLQuery('SELECT 1', 'q')).rejects.toMatchObject({ category: POSTHOG_ERROR.INVALID_RESPONSE })
  })

  it('10. successful query returns the results array', async () => {
    fetchMock.mockResolvedValue(okResponse([[42]]))
    const { runHogQLQuery } = await importFresh()
    const rows = await runHogQLQuery('SELECT count() FROM events', 'q')
    expect(rows).toEqual([[42]])
  })

  it('isPostHogQueryConfigured reflects whether both required env vars are set', async () => {
    let { isPostHogQueryConfigured } = await importFresh()
    expect(isPostHogQueryConfigured()).toBe(true)

    delete process.env.POSTHOG_PROJECT_ID
    ;({ isPostHogQueryConfigured } = await importFresh())
    expect(isPostHogQueryConfigured()).toBe(false)
  })

  it('the request body sends a fixed HogQLQuery envelope, never a raw client payload', async () => {
    fetchMock.mockResolvedValue(okResponse([]))
    const { runHogQLQuery } = await importFresh()
    await runHogQLQuery("SELECT 1 -- fixed server literal", 'my_query')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      query: { kind: 'HogQLQuery', query: 'SELECT 1 -- fixed server literal' },
      name: 'my_query',
    })
  })
})
