'use client'

import { useEffect, useState } from 'react'

/**
 * SSR-safe media query hook. Returns `false` until mounted (matching the
 * server-rendered guess), then the real match — updated live via the
 * MediaQueryList `change` event so it tracks resizes across the breakpoint.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const handleChange = (event) => setMatches(event.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [query])

  return matches
}
