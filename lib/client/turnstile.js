'use client'

/**
 * Client side of Cloudflare Turnstile (see lib/server/turnstile.js).
 *
 * Runs the widget on demand instead of rendering one per form: on submit we
 * mount a throwaway container, execute the challenge with
 * appearance "interaction-only" (invisible for most visitors; a small
 * checkbox only shows when Cloudflare wants an interaction), resolve the
 * token and tear the widget down. Every landing variant shares
 * useCreateEventForm, so this covers all hero + final CTA forms at once.
 *
 * Returns null when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (local dev);
 * the server skips verification in the same situation.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TOKEN_TIMEOUT_MS = 60000

let scriptPromise = null

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('turnstile_ssr'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_unavailable')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile_load_failed'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function getTurnstileSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''
}

/**
 * @param {{ action: string }} options
 * @returns {Promise<string|null>}
 */
export async function getTurnstileToken({ action }) {
  const sitekey = getTurnstileSiteKey()
  if (!sitekey) return null

  const turnstile = await loadTurnstileScript()

  return new Promise((resolve, reject) => {
    const container = document.createElement('div')
    // Bottom-centre so an interactive challenge, when shown, is visible on
    // phones without covering the form's error area.
    container.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647'
    document.body.appendChild(container)

    let widgetId = null
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        if (widgetId != null) turnstile.remove(widgetId)
      } catch {
        // already removed
      }
      container.remove()
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error('turnstile_timeout')), TOKEN_TIMEOUT_MS)

    try {
      widgetId = turnstile.render(container, {
        sitekey,
        action,
        appearance: 'interaction-only',
        callback: (token) => finish(resolve, token),
        'error-callback': () => finish(reject, new Error('turnstile_error')),
        'expired-callback': () => finish(reject, new Error('turnstile_expired')),
      })
    } catch (error) {
      finish(reject, error)
    }
  })
}
