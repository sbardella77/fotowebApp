import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const BADGE_PATH = 'public/brand/snaprooms-qr-badge.svg'
// Locks the canonical badge geometry in place — this hash must never change
// as a side effect of an unrelated task. If it legitimately needs to change,
// that must be a conscious, explicitly-reviewed edit to the asset itself.
const BADGE_SHA256 = 'b67415b886b15cd308aae42d5dde97699be3ab31ed58b928e111d10d492ec176'

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const QR_SURFACES = [
  'components/event-qr-modal.jsx',
  'app/event/[slug]/print/page.js',
]

describe('QR badge derivative (canonical snaprooms-badge.svg, background stripped)', () => {
  it('exists at the expected path', () => {
    expect(existsSync(resolve(ROOT, BADGE_PATH))).toBe(true)
  })

  it('carries no external background fill — the source badge\'s black square-behind-circle was removed', () => {
    const svg = readComponent(BADGE_PATH)
    expect(svg).not.toContain('#010101')
  })

  it('preserves the canonical ivory badge and lime geometry fills byte-for-byte (no redrawn paths)', () => {
    const svg = readComponent(BADGE_PATH)
    // Ivory badge + lens fills from the source artwork.
    expect(svg).toContain('#FCF9F5')
    expect(svg).toContain('#FBF9F4')
    // A sample of the lime-shade fills from the source artwork — proof the
    // 67 remaining paths (68 minus the removed background) are untouched,
    // not a hand-simplified/approximate recreation.
    expect(svg).toContain('#B2D32C')
    expect(svg).toContain('#A9CE21')
    expect(svg).toContain('#AFD330')
  })

  it('is well-formed SVG with the original viewBox preserved', () => {
    const svg = readComponent(BADGE_PATH)
    expect(svg).toContain('viewBox="0 0 1254 1254"')
    expect((svg.match(/<path /g) || []).length).toBe(67)
  })

  it('remains byte-for-byte unchanged (locked geometry — no redraw, no re-derivation)', () => {
    const bytes = readFileSync(resolve(ROOT, BADGE_PATH))
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(hash).toBe(BADGE_SHA256)
  })
})

describe('every QR rendering surface uses the canonical badge, not a generic camera icon', () => {
  it.each(QR_SURFACES)('%s has no legacy Camera icon or old static logo asset', (relPath) => {
    const source = readComponent(relPath)
    expect(source).not.toContain('Camera')
    expect(source).not.toContain('snaprooms-logo.svg')
  })

  it.each(QR_SURFACES)('%s references the canonical QR badge asset', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain('/brand/snaprooms-qr-badge.svg')
  })

  it('EventQRModal keeps the center overlay small relative to the QR (readability / error-correction margin)', () => {
    const source = readComponent('components/event-qr-modal.jsx')
    // QR is rendered at size={200}; the center overlay must stay a small
    // fraction of that (h-10 w-10 = 40px = 20% of width), not grow to
    // dominate the code.
    expect(source).toMatch(/size=\{200\}/)
    expect(source).toMatch(/absolute left-1\/2 top-1\/2 h-10 w-10 -translate-x-1\/2 -translate-y-1\/2[^"]*"\s*\/>/)
  })

  it('EventQRModal QR uses high error correction (level H) to tolerate the center overlay', () => {
    const source = readComponent('components/event-qr-modal.jsx')
    expect(source).toContain('level="H"')
  })
})

describe('downloaded QR PNG includes the canonical badge (matches the on-screen version)', () => {
  const source = readComponent('components/event-qr-modal.jsx')

  it('handleDownload loads the canonical badge asset, not a hand-recreated one', () => {
    expect(source).toMatch(/QR_BADGE_SRC\s*=\s*['"]\/brand\/snaprooms-qr-badge\.svg['"]/)
    expect(source).toContain('loadImage(QR_BADGE_SRC)')
  })

  it('handleDownload composites the badge onto the same canvas as the QR pattern (Approach B)', () => {
    // Both the QR image and the badge image must be drawn onto the export
    // canvas — proof the download is a full composite, not just the raw
    // QRCodeSVG serialization it used to be.
    expect(source).toMatch(/ctx\.drawImage\(qrImage/)
    expect(source).toMatch(/ctx\.drawImage\(badgeImage/)
  })

  it('scales the badge proportionally for the larger downloaded canvas (20% box / 16% content, same ratio as on-screen)', () => {
    expect(source).toContain('QR_BADGE_BOX_RATIO = 0.2')
    expect(source).toContain('QR_BADGE_CONTENT_RATIO = 0.16')
  })

  it('the download pipeline never reintroduces the legacy static logo or a Lucide icon in its place', () => {
    // Scoped to the handleDownload function body specifically, not the
    // whole file (the whole-file check already exists above).
    const start = source.indexOf('const handleDownload')
    const end = source.indexOf('\n  }, [filename, showToast])', start)
    const fnBody = source.slice(start, end)
    expect(fnBody).not.toContain('snaprooms-logo.svg')
    expect(fnBody).not.toContain('Camera')
  })

  it('QR error correction level is untouched by the download-pipeline change (still level H)', () => {
    expect(source).toContain('level="H"')
  })
})
