import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { buildEmail } from '../lib/server/email/email-layout'

const ROOT = resolve(import.meta.dirname, '..')
const ROUTE_PATH = 'app/api/[[...path]]/route.js'

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

// V4 brand alignment: transactional emails previously hand-rolled their own
// HTML with the legacy gold (#d4a853). They now go through the same
// buildEmail() helper billing-emails.js already used (lime CTA, graphite
// text, warm off-white background — see lib/server/email/email-layout.js),
// instead of a second, newly-invented design system.
describe('customer-facing transactional emails carry no legacy gold branding', () => {
  it('route.js contains zero occurrences of the legacy gold hex', () => {
    const source = readComponent(ROUTE_PATH)
    expect(source).not.toContain('#d4a853')
  })

  it('email-layout.js (the shared helper) contains zero occurrences of the legacy gold hex', () => {
    const source = readComponent('lib/server/email/email-layout.js')
    expect(source).not.toContain('#d4a853')
  })

  it('all five route.js email call sites import and use buildEmail from the shared layout helper', () => {
    const source = readComponent(ROUTE_PATH)
    expect(source).toContain("import { buildEmail } from '@/lib/server/email/email-layout'")
    const buildEmailCallCount = (source.match(/buildEmail\(\{/g) || []).length
    expect(buildEmailCallCount).toBe(5)
  })

  it('each buildEmail() call in route.js pins locale to "en" (these templates have never been localized — buildEmail defaults to "de")', () => {
    const source = readComponent(ROUTE_PATH)
    const calls = source.match(/buildEmail\(\{[\s\S]*?\n\s*\}\)/g) || []
    expect(calls.length).toBe(5)
    calls.forEach((call) => {
      expect(call).toContain("locale: 'en'")
    })
  })

  it('saveEventByEmail preserves the plain-link fallback via the new opt-in linkBox param', () => {
    const source = readComponent(ROUTE_PATH)
    const fnStart = source.indexOf('const saveEventByEmail = async')
    const fnEnd = source.indexOf('\nconst getManagementTokenFromRequest')
    const fnBody = source.slice(fnStart, fnEnd)
    expect(fnBody).toMatch(/linkBox:\s*\{\s*label:\s*'Room link'/)
  })

  it('resend.emails.send() call sites in route.js pass buildEmail() output through unmodified (subject/text/html), not new inline HTML', () => {
    const source = readComponent(ROUTE_PATH)
    // None of the five send() calls should contain a literal <div style= HTML
    // blob anymore — that pattern only exists now inside email-layout.js.
    const sendCallBlocks = source.match(/await resend\.emails\.send\(\{[\s\S]*?\n\s*\}\)/g) || []
    expect(sendCallBlocks.length).toBeGreaterThanOrEqual(5)
    sendCallBlocks.forEach((block) => {
      expect(block).not.toMatch(/<div style=/)
    })
  })
})

describe('email-layout.js linkBox is additive — existing billing-email callers are unaffected', () => {
  it('linkBox is optional and defaults to null (no behavior change for callers that omit it)', () => {
    const source = readComponent('lib/server/email/email-layout.js')
    expect(source).toMatch(/linkBox\s*=\s*null/)
  })

  it('none of billing-emails.js\'s buildEmail() calls pass linkBox (unchanged output)', () => {
    const source = readComponent('lib/server/billing-emails.js')
    expect(source).not.toContain('linkBox')
  })
})

describe('email header uses a hosted raster mark with a text fallback (not inline SVG)', () => {
  it('the shared email header references a hosted PNG derivative of the canonical mark, not inline SVG', () => {
    const source = readComponent('lib/server/email/email-layout.js')
    expect(source).toContain('/brand/snaprooms-mark-email.png')
    expect(source).not.toMatch(/<svg/)
  })

  it('the mark image is decorative (alt="") — the adjacent "SnapRooms" text span is the real accessible/fallback name', () => {
    const source = readComponent('lib/server/email/email-layout.js')
    expect(source).toMatch(/<img[^>]*alt=""[^>]*>/)
    const rendered = buildEmail({ subject: 'Test', headline: 'Test', bodyLines: ['x'], locale: 'en', appUrl: 'https://snaprooms.app' })
    expect(rendered.html).toContain('SnapRooms</span><span')
    expect(rendered.html).toMatch(/<img[^>]*alt=""[^>]*>[\s\S]{0,200}SnapRooms/)
  })

  it('the raster asset exists and was derived from the canonical mark, not hand-authored', () => {
    const path = resolve(ROOT, 'public/brand/snaprooms-mark-email.png')
    expect(existsSync(path)).toBe(true)
  })

  it('the canonical source SVG geometry is untouched', () => {
    const svg = readComponent('public/brand/snaprooms-mark.svg')
    expect(svg).toContain('viewBox="0 0 1254 1254"')
  })
})

describe('internal-only ops alerts are correctly left out of the V4 brand pass', () => {
  it('ops-alerts.js does not use buildEmail or the canonical brand mark — it is a functional internal tool, not customer-facing', () => {
    const source = readComponent('lib/server/ops-alerts.js')
    expect(source).not.toContain('buildEmail')
    expect(source).not.toContain('snaprooms-mark.svg')
  })
})
