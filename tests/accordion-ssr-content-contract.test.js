import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'

const ROOT = resolve(import.meta.dirname, '..')

// Crawlers read the server HTML only. Radix mounts AccordionContent on open
// unless forceMount is set, which left every FAQ answer out of the HTML.
describe('AccordionContent keeps closed answers in the server HTML', () => {
  const source = readFileSync(resolve(ROOT, 'components/ui/accordion.jsx'), 'utf8')

  it('force-mounts the content', () => {
    expect(source).toMatch(/<AccordionPrimitive\.Content[\s\S]*?forceMount/)
  })

  it('hides closed content with display:none so it does not show expanded', () => {
    expect(source).toContain('data-[state=closed]:hidden')
  })
})

describe('Home final CTA wording', () => {
  it('has no gender or article typos in it and es', () => {
    expect(dictionaries.it.landing?.finalCta ?? '').not.toMatch(/gratuita/)
    expect(JSON.stringify(dictionaries.it)).not.toContain('alil ')
    expect(dictionaries.es.landing?.finalCta ?? '').not.toMatch(/gratuita/)
  })
})
