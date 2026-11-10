import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { LOCALES } from '@/lib/i18n/config'

// The Analytics tab renders inside the narrow event side panel, so its layout
// must not depend on viewport breakpoints, and every label it shows must be
// translated instead of falling back to English.

const SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'app/dashboard/components/event-workspace-analytics.jsx'), 'utf8')

describe('event analytics panel', () => {
  it('sizes its grids for the side panel, not the viewport', () => {
    expect(SOURCE).not.toMatch(/\b(sm|md|lg|xl):grid-cols-/)
    expect(SOURCE).toContain('grid grid-cols-2')
  })

  it('shows uploads per view as a count, not a percentage of views', () => {
    expect(SOURCE).not.toMatch(/viewToUploadRate \* 100/)
    expect(SOURCE).toContain('t.eventAnalyticsPhotosPerView')
  })

  it('has every eventAnalytics label in every locale', () => {
    const keys = [...new Set(SOURCE.match(/t\.eventAnalytics[A-Za-z]+/g).map((k) => k.slice(2)))]
    expect(keys.length).toBeGreaterThan(5)
    for (const locale of LOCALES) {
      for (const key of keys) expect(dictionaries[locale].dashboard[key], `${locale}.${key}`).toBeTruthy()
    }
    for (const locale of LOCALES) expect(dictionaries[locale].dashboard.eventAnalyticsStepRate).toContain('{rate}')
  })
})
