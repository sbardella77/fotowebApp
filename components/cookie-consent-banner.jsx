'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations, useLocale } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { initPostHog, withdrawConsentAndCleanup } from '@/lib/analytics/posthog-client'
import { CONSENT_STATES, getStoredConsentState, setStoredConsentState } from '@/lib/consent/cookie'

export const OPEN_PREFERENCES_EVENT = 'snaprooms:open-cookie-preferences'

/**
 * Consent banner + preferences panel for non-essential (analytics)
 * browser storage (PRIVACY-CONSENT-001A/001B).
 *
 * Shown automatically when the stored state is 'unknown' (first visit,
 * or an expired/invalid/previous-policy-version decision — see
 * lib/consent/state.js). Can also be reopened at any time via the
 * `OPEN_PREFERENCES_EVENT` window event, dispatched by the "Cookie
 * Preferences" footer link.
 *
 * All legal/copy text below is PROVISIONAL pending DPO review — see
 * the "consent" namespace in lib/i18n/dictionaries.js.
 */
export function CookieConsentBanner() {
  const t = useTranslations('consent')
  const locale = useLocale()
  const [visible, setVisible] = useState(false)
  const [showPreferences, setShowPreferences] = useState(false)
  const [analyticsChecked, setAnalyticsChecked] = useState(false)
  const headingRef = useRef(null)

  useEffect(() => {
    const current = getStoredConsentState()
    if (current === CONSENT_STATES.UNKNOWN) {
      setVisible(true)
    }
    setAnalyticsChecked(current === CONSENT_STATES.ACCEPTED)

    function onOpenPreferences() {
      setAnalyticsChecked(getStoredConsentState() === CONSENT_STATES.ACCEPTED)
      setShowPreferences(true)
      setVisible(true)
    }

    window.addEventListener(OPEN_PREFERENCES_EVENT, onOpenPreferences)
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, onOpenPreferences)
  }, [])

  useEffect(() => {
    if (visible) headingRef.current?.focus()
  }, [visible])

  if (!visible) return null

  function acceptAll() {
    setStoredConsentState(CONSENT_STATES.ACCEPTED)
    initPostHog()
    setVisible(false)
    setShowPreferences(false)
  }

  function rejectNonEssential() {
    const wasAccepted = getStoredConsentState() === CONSENT_STATES.ACCEPTED
    setStoredConsentState(wasAccepted ? CONSENT_STATES.WITHDRAWN : CONSENT_STATES.REJECTED)
    withdrawConsentAndCleanup()
    setVisible(false)
    setShowPreferences(false)
  }

  function savePreferences() {
    if (analyticsChecked) {
      acceptAll()
    } else {
      rejectNonEssential()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-heading"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur sm:p-6"
    >
      <div className="mx-auto max-w-3xl">
        <h2
          id="cookie-consent-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-base font-semibold text-foreground outline-none"
        >
          {t.bannerTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.bannerBody}{' '}
          <a
            href={localizedPath(locale, '/privacy')}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t.privacyLinkLabel}
          </a>
        </p>

        {showPreferences && (
          <div className="mt-4 space-y-3 rounded-lg border border-border bg-raised/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t.prefsNecessaryLabel}</p>
                <p className="text-xs text-muted-foreground">{t.prefsNecessaryDesc}</p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{t.prefsAlwaysOn}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <label htmlFor="consent-analytics-toggle" className="text-sm font-medium text-foreground">
                  {t.prefsAnalyticsLabel}
                </label>
                <p className="text-xs text-muted-foreground">{t.prefsAnalyticsDesc}</p>
              </div>
              <input
                id="consent-analytics-toggle"
                type="checkbox"
                checked={analyticsChecked}
                onChange={(e) => setAnalyticsChecked(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0"
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {showPreferences ? (
            <button
              type="button"
              onClick={savePreferences}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground sm:flex-none"
            >
              {t.prefsSave}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={acceptAll}
                className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground sm:flex-none"
              >
                {t.acceptAll}
              </button>
              <button
                type="button"
                onClick={rejectNonEssential}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground sm:flex-none"
              >
                {t.rejectNonEssential}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowPreferences((v) => !v)}
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {showPreferences ? t.prefsClose : t.managePreferences}
          </button>
        </div>
      </div>
    </div>
  )
}
