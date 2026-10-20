/**
 * PostHog client-side initialization.
 *
 * Initializes PostHog only in the browser, only when a key is present,
 * and only when the visitor has explicitly accepted analytics consent
 * (PRIVACY-CONSENT-001A/001B) — initPostHog() re-checks this itself as a
 * defensive, fail-closed guard, even though every caller is also
 * expected to check first.
 *
 * The 'posthog-js' SDK is imported dynamically, inside initPostHog()
 * itself, rather than statically at module load — so the SDK's own code
 * is never fetched/parsed by the browser at all unless and until a
 * visitor has actually accepted. This file itself stays tiny and SDK-free
 * until that happens.
 */

import { isConsentAccepted } from '@/lib/consent/cookie'
import { sanitizeAnalyticsProperties } from './sanitize-url'

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'

let initialized = false
let cachedPostHog = null
let loadPromise = null

export async function initPostHog() {
  if (typeof window === 'undefined') return
  if (initialized) return
  if (!POSTHOG_KEY) return
  if (!isConsentAccepted()) return

  if (!loadPromise) {
    loadPromise = import('posthog-js').then((mod) => mod.default || mod)
  }

  try {
    const posthog = await loadPromise
    // Re-check consent after the async import resolves — a visitor could
    // have rejected/withdrawn in the time it took the chunk to load.
    if (!isConsentAccepted()) return

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      // Disable automatic pageviews — we track them explicitly for better control
      capture_pageview: false,
      // Respect Do Not Track
      respect_dnt: true,
      // Explicit, documented data-minimization decisions (GEO-PRIVACY-001/002/003):
      // both were previously left at the SDK's own default rather than a
      // reviewed choice. Session Replay is additionally confirmed disabled
      // at the project level, but this makes that a defended code-level
      // guarantee rather than something that could silently change if the
      // project's dashboard toggle is ever flipped without a matching
      // code review.
      autocapture: false,
      disable_session_recording: true,
      // Strip known sensitive query params (e.g. eventSlug) out of
      // $current_url/$referrer/$initial_referrer before every event is
      // sent, and out of posthog-js's own internal $set_once first-touch
      // attribution bundle (see sanitize-url.js — confirmed by tracing
      // the installed posthog-js that both pipelines call this hook).
      //
      // GEO-PRIVACY-003C: this SDK version logs a deprecation warning for
      // `sanitize_properties` in favor of `before_send`, but migrating was
      // deliberately NOT done here. Tracing the installed SDK found only
      // one call site for `before_send` (inside the main capture() event
      // pipeline) and no equivalent dedicated call site guarding the
      // $set_once attribution-properties computation the way
      // `sanitize_properties` has — so `before_send` cannot be shown to
      // cover the $set_once bundle without deeper, riskier re-engineering
      // this environment has no way to verify behaviorally (no browser
      // available to confirm live). Retaining the working hook and eating
      // the console warning is the safer choice until that can be proven.
      sanitize_properties: (properties) => sanitizeAnalyticsProperties(properties),
      // Load flags asynchronously without blocking
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') {
          ph.debug(false)
        }
      },
    })
    cachedPostHog = posthog
    initialized = true
  } catch (e) {
    // Silently fail in production so analytics never break the app
    if (process.env.NODE_ENV === 'development') {
      console.warn('[analytics] PostHog init failed:', e)
    }
  }
}

/**
 * Returns the live PostHog instance ONLY if initPostHog() has actually
 * completed and consent is still accepted — never the raw imported SDK
 * module regardless of initialization state. This is the structural
 * guarantee that trackEvent()/identifyUser()/etc. (lib/analytics/
 * track-client.js) cannot reach a live SDK instance without consent,
 * even if a future call site forgot its own consent check.
 */
export function getPostHog() {
  if (typeof window === 'undefined') return null
  if (!initialized) return null
  if (!isConsentAccepted()) return null
  return cachedPostHog
}

/**
 * Withdrawal / rejection cleanup.
 *
 * Deliberately does NOT call posthog.reset() — tracing the installed SDK
 * (posthog-js@1.372.5) shows reset() calls this.consent.reset(), which
 * clears PostHog's OWN internal opt-in/opt-out persistence key
 * (`__ph_opt_in_out_<token>`), i.e. reset() would undo the very opt-out
 * this function exists to apply. opt_out_capturing() alone is the
 * SDK's own documented, stable mechanism for this: it does not clear
 * persistence and does not generate a new distinct_id (confirmed by
 * reading its implementation — it is a no-op for persistence in the
 * non-cookieless configuration this app uses).
 *
 * To still proactively clear the old identifier/properties (the
 * project's own "clean up analytics-owned storage" requirement), this
 * removes PostHog's main persistence key directly — `ph_<token>_posthog`
 * is PostHog's long-standing, documented, stable persistence-naming
 * convention (confirmed in the installed SDK source), not an internal
 * implementation detail at risk of silently changing. The opt-out key
 * itself, the "snaprooms_cookie_consent" cookie, and every other cookie
 * (auth, locale, etc.) are never touched here.
 */
export function withdrawConsentAndCleanup() {
  if (typeof window === 'undefined') return

  if (initialized && cachedPostHog) {
    try {
      cachedPostHog.opt_out_capturing()
    } catch {
      // Ignore — if the SDK is in a bad state, falling through to the
      // manual storage cleanup below still removes the stored identifier.
    }
  }

  if (!POSTHOG_KEY) return
  const persistenceKey = `ph_${POSTHOG_KEY}_posthog`

  try {
    window.localStorage?.removeItem(persistenceKey)
  } catch {
    // Ignore — localStorage can throw in some privacy modes
  }

  try {
    document.cookie = `${persistenceKey}=; path=/; max-age=0; SameSite=Lax`
  } catch {
    // Ignore
  }

  initialized = false
  cachedPostHog = null
  loadPromise = null
}
