import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(ROOT, 'components/event-qr-modal.jsx'), 'utf8')

describe('EventQRModal — dialog accessibility (Escape-to-close, ARIA semantics)', () => {
  it('the dialog content carries role="dialog" and aria-modal', () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
  })

  it('registers an Escape-key handler that calls onClose, matching the PhotoLightbox pattern', () => {
    expect(source).toMatch(/e\.key === ['"]Escape['"]\)\s*\{\s*onCloseRef\.current\(\)/)
    expect(source).toContain("window.addEventListener('keydown'")
    expect(source).toContain("window.removeEventListener('keydown'")
  })

  it('the Escape listener is gated on isOpen and cleaned up (no leaked listeners across renders)', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!isOpen \|\| typeof window === ['"]undefined['"]\) return/)
  })
})

// No jsdom/@testing-library/react exists anywhere in this project's test
// suite (every one of its 2000+ tests is Node-environment, source-contract
// style) — adding that infra for one file would be its own small refactor,
// so these assert the implementation structurally, the same way every other
// regression test in this suite works. The actual runtime behavior (real
// browser Tab-order/focus semantics, which jsdom only approximates anyway)
// was verified live via Playwright against the deployed Preview — see the
// QA report for that evidence.
describe('EventQRModal — focus containment (initial focus, Tab/Shift+Tab wrap, restoration)', () => {
  it('captures the ref used to scope focus queries to the dialog only', () => {
    expect(source).toContain('const dialogRef = useRef(null)')
    expect(source).toMatch(/ref=\{dialogRef\}\s*\n\s*role="dialog"/)
  })

  it('moves focus to the first focusable element inside the dialog on open', () => {
    expect(source).toContain("dialog?.querySelector(focusableSelector)?.focus()")
  })

  it('Tab from the last focusable element wraps to the first', () => {
    expect(source).toMatch(/!e\.shiftKey && document\.activeElement === last\)\s*\{\s*e\.preventDefault\(\)\s*first\.focus\(\)/)
  })

  it('Shift+Tab from the first focusable element wraps to the last', () => {
    expect(source).toMatch(/e\.shiftKey && document\.activeElement === first\)\s*\{\s*e\.preventDefault\(\)\s*last\.focus\(\)/)
  })

  it('restores focus to whatever was focused before opening, via the effect cleanup (covers Escape, backdrop click, and the X button — not just Escape)', () => {
    expect(source).toContain('const previouslyFocused = document.activeElement')
    expect(source).toMatch(/return \(\) => \{\s*window\.removeEventListener\('keydown', handleKeyDown\)\s*if \(previouslyFocused instanceof HTMLElement\) previouslyFocused\.focus\(\)/)
  })

  it('the effect is keyed only on [isOpen], not [isOpen, onClose] — a fresh onClose closure from the parent on every render cannot re-fire this effect and steal focus back mid-interaction', () => {
    const effectStart = source.indexOf('Focus management: move focus into the dialog on open')
    const effectSlice = source.slice(effectStart, effectStart + 2500)
    expect(effectSlice).toMatch(/\}, \[isOpen\]\)/)
    expect(effectSlice).toContain('onCloseRef.current')
  })
})
