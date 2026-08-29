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
    expect(source).toMatch(/e\.key === ['"]Escape['"]\)\s*onClose\(\)/)
    expect(source).toContain("window.addEventListener('keydown'")
    expect(source).toContain("window.removeEventListener('keydown'")
  })

  it('the Escape listener is gated on isOpen and cleaned up (no leaked listeners across renders)', () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!isOpen \|\| typeof window === ['"]undefined['"]\) return/)
  })
})
