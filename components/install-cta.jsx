'use client'

import { useState, useEffect } from 'react'
import { X, Download, Smartphone, Monitor, Share2, Info } from 'lucide-react'
import { useInstallPrompt } from '@/hooks/use-install-prompt'
import { useTranslations } from '@/components/i18n-provider'
import { trackEvent } from '@/lib/analytics/track-client'
import {
  EVENT_INSTALL_CTA_VIEWED,
  EVENT_INSTALL_CTA_CLICKED,
  EVENT_INSTALL_PROMPT_ACCEPTED,
  EVENT_INSTALL_PROMPT_DISMISSED,
  EVENT_ADD_TO_HOME_SCREEN_HELP_OPENED,
} from '@/lib/analytics/events'

export function InstallCta({ mode = 'landing', className = '' }) {
  const { isInstallable, isIOS, isStandalone, isDesktop, hasPromptFired, prompt } =
    useInstallPrompt()
  const t = useTranslations('install')
  const [dismissed, setDismissed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [hasTrackedView, setHasTrackedView] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const key = mode === 'room' ? 'snaprooms_install_dismissed_room' : 'snaprooms_install_dismissed'
      if (localStorage.getItem(key)) {
        setDismissed(true)
      }
    } catch {
      // ignore
    }
  }, [mode])

  useEffect(() => {
    if (!hasTrackedView && hasPromptFired && !isStandalone && !dismissed) {
      trackEvent(EVENT_INSTALL_CTA_VIEWED, { mode, platform: isIOS ? 'ios' : isDesktop ? 'desktop' : 'android' })
      setHasTrackedView(true)
    }
  }, [hasTrackedView, hasPromptFired, isStandalone, dismissed, mode, isIOS, isDesktop])

  if (isStandalone) return null
  if (dismissed) return null
  if (!hasPromptFired) return null

  const handleDismiss = () => {
    trackEvent(EVENT_INSTALL_PROMPT_DISMISSED, { mode })
    setDismissed(true)
    try {
      const key = mode === 'room' ? 'snaprooms_install_dismissed_room' : 'snaprooms_install_dismissed'
      localStorage.setItem(key, '1')
    } catch {
      // ignore
    }
  }

  const handlePrimaryAction = async () => {
    trackEvent(EVENT_INSTALL_CTA_CLICKED, { mode, platform: isIOS ? 'ios' : isDesktop ? 'desktop' : 'android' })
    if (isInstallable) {
      const result = await prompt()
      if (result.outcome === 'accepted') {
        trackEvent(EVENT_INSTALL_PROMPT_ACCEPTED, { mode })
      } else {
        trackEvent(EVENT_INSTALL_PROMPT_DISMISSED, { mode, source: 'prompt_declined' })
      }
    } else {
      setShowHelp(true)
      trackEvent(EVENT_ADD_TO_HOME_SCREEN_HELP_OPENED, { mode, platform: isIOS ? 'ios' : isDesktop ? 'desktop' : 'other' })
    }
  }

  const description = mode === 'room' ? t.roomDescription : t.description
  const primaryLabel = isIOS
    ? t.addToHomeScreen
    : isInstallable
      ? t.installApp
      : isDesktop
        ? t.saveShortcut
        : t.addToHomeScreen

  const PlatformIcon = isIOS ? Smartphone : isDesktop ? Monitor : Download

  return (
    <>
      <div
        className={`group relative overflow-hidden rounded-2xl border border-white/[0.04] bg-surface p-5 shadow-card transition-colors hover:border-white/[0.08] ${className}`}
      >
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground opacity-60 transition-opacity hover:bg-white/5 hover:opacity-100"
          aria-label={t.dismiss}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-4 pr-8">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-105">
            <PlatformIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-foreground">{t.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePrimaryAction}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                <Download className="h-3.5 w-3.5" />
                {primaryLabel}
              </button>
              {!isInstallable && (
                <button
                  type="button"
                  onClick={() => {
                    setShowHelp(true)
                    trackEvent(EVENT_ADD_TO_HOME_SCREEN_HELP_OPENED, { mode, platform: isIOS ? 'ios' : isDesktop ? 'desktop' : 'other' })
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                  {t.openSettings}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showHelp && (
        <InstallHelpModal
          isIOS={isIOS}
          isDesktop={isDesktop}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  )
}

function InstallHelpModal({ isIOS, isDesktop, onClose }) {
  const t = useTranslations('install')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-white/[0.06] bg-surface p-6 shadow-elevated sm:rounded-3xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-foreground">{t.openSettings}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label={t.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5">
          {isIOS ? (
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Share2 className="h-4 w-4" />
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.iOSInstructions}</p>
            </div>
          ) : isDesktop ? (
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Monitor className="h-4 w-4" />
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.desktopInstructions}</p>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Smartphone className="h-4 w-4" />
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.fallbackInstructions}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-7 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t.dismiss}
        </button>
      </div>
    </div>
  )
}
