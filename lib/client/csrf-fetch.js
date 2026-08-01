let cachedCsrfToken = null
let csrfFetchPromise = null

export async function getCsrfToken({ force = false } = {}) {
  if (cachedCsrfToken && !force) return cachedCsrfToken

  if (csrfFetchPromise && !force) return csrfFetchPromise

  csrfFetchPromise = fetch('/api/csrf', {
    method: 'GET',
    credentials: 'same-origin',
  })
    .then(async (res) => {
      if (res.status === 401) {
        cachedCsrfToken = null
        throw new Error('Owner authentication required')
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Unable to fetch CSRF token')
      }
      cachedCsrfToken = data.csrfToken
      return cachedCsrfToken
    })
    .finally(() => {
      csrfFetchPromise = null
    })

  return csrfFetchPromise
}

export function clearCsrfToken() {
  cachedCsrfToken = null
}

function isMutableMethod(method) {
  const m = (method || 'GET').toUpperCase()
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

function isSameOrigin(url) {
  if (typeof url !== 'string') return true
  if (url.startsWith('/')) return true
  try {
    const parsed = new URL(url)
    // Dev convenience: any localhost port is treated as same-origin
    if (parsed.hostname === 'localhost') return true
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

/**
 * Drop-in fetch replacement that adds CSRF tokens to same-origin mutative
 * requests and retries once on CSRF failure.
 */
export async function csrfFetch(url, options = {}) {
  const mutable = isMutableMethod(options.method)
  const headers = { ...(options.headers || {}) }

  if (mutable && isSameOrigin(url)) {
    try {
      const token = await getCsrfToken()
      headers['X-CSRF-Token'] = token
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        // eslint-disable-next-line no-console
        console.warn('[csrfFetch] Failed to fetch CSRF token:', error.message)
      }
    }
  }

  const response = await fetch(url, { ...options, headers })

  if (response.status === 403 && !options._csrfRetry) {
    const data = await response.clone().json().catch(() => ({}))
    if (data.code === 'csrf_invalid' || data.code === 'csrf_missing') {
      clearCsrfToken()
      return csrfFetch(url, { ...options, _csrfRetry: true })
    }
  }

  return response
}
