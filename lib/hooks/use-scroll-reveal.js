'use client'

import { useEffect } from 'react'

/**
 * Adds the `revealed` class to every `.reveal` element already on the page
 * once it scrolls into view (see the `.reveal` / `.reveal.revealed` rules in
 * app/globals.css). Each element is observed once and released after its
 * first reveal — this never un-reveals on scroll-away.
 */
export function useScrollReveal({ threshold = 0.1, rootMarginPx = 40 } = {}) {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold, rootMargin: `0px 0px -${rootMarginPx}px 0px` }
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [threshold, rootMarginPx])
}
