'use client'

import { useEffect, useRef } from 'react'

// Activity signals considered "the user is here". Click is covered by
// mousedown/touchstart already firing; keydown catches keyboard-only use.
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel']

/**
 * Calls `onIdle` once after `timeoutMs` of no user activity (mouse, keyboard,
 * touch, scroll) while `enabled`.
 *
 * Tracked by wall-clock timestamp rather than a single blind setTimeout, so
 * it stays correct across two cases a naive "reset the timeout on activity"
 * implementation gets wrong:
 *  - Background tabs: browsers throttle/delay timers in hidden tabs, so a
 *    setTimeout armed before backgrounding can fire late (or effectively
 *    not at all until the tab is foregrounded again).
 *  - Returning to an already-stale tab: the elapsed time is checked
 *    immediately on `visibilitychange`, so a tab backgrounded past the
 *    timeout logs out as soon as it's foregrounded, rather than granting a
 *    fresh `timeoutMs` just for switching back to it.
 *
 * Does not track activity across tabs/windows — each tab runs its own timer.
 */
export function useIdleTimer({ timeoutMs, onIdle, enabled = true }) {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return

    let timeoutId
    let lastActivityAt = Date.now()

    const check = () => {
      const elapsed = Date.now() - lastActivityAt
      if (elapsed >= timeoutMs) {
        onIdleRef.current?.()
        return
      }
      timeoutId = setTimeout(check, timeoutMs - elapsed)
    }

    const markActive = () => {
      lastActivityAt = Date.now()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      clearTimeout(timeoutId)
      check()
    }

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, markActive, { passive: true }))
    document.addEventListener('visibilitychange', onVisibilityChange)

    timeoutId = setTimeout(check, timeoutMs)

    return () => {
      clearTimeout(timeoutId)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActive))
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, timeoutMs])
}
