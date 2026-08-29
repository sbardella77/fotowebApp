import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const APP_SHELL_SURFACES = [
  'app/dashboard/components/dashboard-sidebar.jsx',
  'app/dashboard/login/page-client.js',
  'app/dashboard/reset-password/page-client.js',
  'app/dashboard/setup-password/page-client.js',
]

describe('canonical logo is used across Dashboard/app-shell surfaces (Preview bugfix pass)', () => {
  it.each(APP_SHELL_SURFACES)('%s imports SnapRoomsIcon, not a hand-coded Camera-icon lockup', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain("from '@/components/marketing/logo'")
    // The legacy lockup: a generic lucide Camera icon inside a bg-primary
    // rounded box, standing in for the brand mark.
    expect(source).not.toMatch(/bg-primary text-primary-foreground[^>]*>\s*<Camera/)
    expect(source).not.toMatch(/<Camera className="h-\[18px\] w-\[18px\]"/)
  })

  it('event-qr-modal.jsx (QR/share surface) uses the canonical QR badge, not the legacy static asset or a generic icon', () => {
    const source = readComponent('components/event-qr-modal.jsx')
    expect(source).not.toContain('snaprooms-logo.svg')
    expect(source).not.toContain('Camera')
  })

  it('the legacy public/snaprooms-logo.svg asset has been removed', () => {
    expect(existsSync(resolve(ROOT, 'public/snaprooms-logo.svg'))).toBe(false)
  })

  it('app/layout.js no longer preloads the removed legacy logo asset', () => {
    const source = readComponent('app/layout.js')
    expect(source).not.toContain('snaprooms-logo.svg')
  })
})
