'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Hook to handle PWA install prompt behavior across platforms.
 *
 * - Android/Chrome: beforeinstallprompt event
 * - iOS Safari: no native prompt; show manual instructions
 * - Desktop Chrome/Edge: beforeinstallprompt event
 * - Others: fallback to bookmark instructions
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isInstallable, setIsInstallable] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [hasPromptFired, setHasPromptFired] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    setIsStandalone(standalone)

    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent)
    const isMac = /macintosh/.test(userAgent)
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent)
    setIsIOS(isIOSDevice)
    setIsDesktop(!isMobile)

    const onBeforeInstallPrompt = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setIsInstallable(true)
      setHasPromptFired(true)
    }

    const onAppInstalled = () => {
      setDeferredPrompt(null)
      setIsInstallable(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    // On some browsers the prompt never fires; after a timeout assume not installable natively
    const timeout = setTimeout(() => {
      setHasPromptFired(true)
    }, 3500)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      clearTimeout(timeout)
    }
  }, [])

  const prompt = useCallback(async () => {
    if (!deferredPrompt) return { outcome: 'no-prompt' }
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setIsInstallable(false)
    return { outcome }
  }, [deferredPrompt])

  return {
    isInstallable,
    isIOS,
    isStandalone,
    isDesktop,
    hasPromptFired,
    prompt,
  }
}
