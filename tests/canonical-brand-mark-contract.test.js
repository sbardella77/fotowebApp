import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const MARK_PATH = 'public/brand/snaprooms-mark.svg'
const BADGE_PATH = 'public/brand/snaprooms-qr-badge.svg'
const MARK_SHA256 = '35923417bd785946d5a2e4e9b47810179f9eaa04fdea72064eb0364c5cc6b3fb'
const BADGE_SHA256 = 'b67415b886b15cd308aae42d5dde97699be3ab31ed58b928e111d10d492ec176'

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

function sha256(relPath) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, relPath))).digest('hex')
}

describe('snaprooms-mark.svg — programmatic derivative of the canonical badge', () => {
  it('exists', () => {
    expect(existsSync(resolve(ROOT, MARK_PATH))).toBe(true)
  })

  it('is exactly the canonical badge with only the ivory circular backing removed', () => {
    const badge = readComponent(BADGE_PATH)
    const mark = readComponent(MARK_PATH)
    const openMarker = '<path fill="#FCF9F5"'
    const openIdx = badge.indexOf(openMarker)
    const closeIdx = badge.indexOf('</path>', openIdx) + '</path>'.length
    const rawRemoval = badge.slice(0, openIdx) + badge.slice(closeIdx)
    expect(mark).toBe(rawRemoval)
  })

  it('keeps the lens-highlight and every lime-shade path untouched (66 of the badge\'s 67 paths)', () => {
    const mark = readComponent(MARK_PATH)
    expect((mark.match(/<path /g) || []).length).toBe(66)
    expect(mark).toContain('#FBF9F4') // lens highlight, preserved
    expect(mark).toContain('#B2D32C') // sample lime fill, preserved
    expect(mark).not.toContain('#FCF9F5') // ivory badge backing, removed
  })

  it('both canonical assets remain byte-for-byte frozen', () => {
    expect(sha256(MARK_PATH)).toBe(MARK_SHA256)
    expect(sha256(BADGE_PATH)).toBe(BADGE_SHA256)
  })
})

describe('SnapRoomsIcon renders the canonical mark, not hand-authored approximate geometry', () => {
  const source = readComponent('components/marketing/logo.jsx')

  it('contains no manually-authored SVG path/circle geometry for the icon', () => {
    // The old implementation hand-drew the mark with <path>/<circle> and
    // literal coordinate data (e.g. "M5 11V5H11...", "cx=\"16\" cy=\"16\"").
    // None of that should remain — the icon must come from the asset file.
    expect(source).not.toMatch(/<path\s+d="M5 11/)
    expect(source).not.toMatch(/<circle\s+cx="16"/)
    expect(source).not.toContain('strokeLinecap')
  })

  it('SnapRoomsIcon renders the canonical mark asset', () => {
    expect(source).toMatch(/src=["']\/brand\/snaprooms-mark\.svg["']/)
  })
})

const BRAND_LOCKUP_SURFACES = [
  'app/dashboard/components/dashboard-sidebar.jsx',
  'app/dashboard/login/page-client.js',
  'app/dashboard/reset-password/page-client.js',
  'app/dashboard/setup-password/page-client.js',
  'components/marketing/nav.jsx',
  'components/marketing/footer.jsx',
  'components/home-page-client.jsx',
]

describe('every marketing/Dashboard/auth brand surface uses SnapRoomsIcon', () => {
  it.each(BRAND_LOCKUP_SURFACES)('%s imports and uses the canonical icon component', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toMatch(/SnapRoomsIcon|SnapRoomsLogo/)
    expect(source).toContain("from '@/components/marketing/logo'")
  })
})

describe('Guest Room brand-only exception (narrow, explicitly approved)', () => {
  const source = readComponent('components/room-page-client.jsx')

  it('the "not found" header and the main header both use the canonical icon', () => {
    // Two Link-wrapped "SnapRooms" wordmark headers, both now icon-consistent.
    const occurrences = (source.match(/<SnapRoomsIcon className="h-9 w-9 shrink-0" \/>/g) || []).length
    expect(occurrences).toBe(2)
  })

  it('the branded loading-state icon uses the canonical icon', () => {
    expect(source).toContain('<SnapRoomsIcon className="h-14 w-14" />')
  })

  it('the functional RoomNotFound empty-state Camera icon is untouched (not a brand lockup)', () => {
    // No adjacent "SnapRooms" wordmark or home Link — genuinely decorative,
    // must remain a plain Lucide icon, not be swapped for the brand mark.
    expect(source).toContain('<Camera className="h-7 w-7" />')
  })

  it('upload/CTA/Moments/analytics/gallery/event-state logic is untouched — only the icon markup and one import line changed', () => {
    const diffRelevantMarkers = [
      'uploadPhotos', 'handleUpload', 'trackEvent', 'EVENT_ROOM', 'PhotoGalleryGrid',
    ]
    // Sanity: these still exist in the file (they were never meant to be
    // removed) — this is a smoke check, not a full behavioral diff.
    diffRelevantMarkers.forEach((marker) => {
      expect(source.includes(marker) || source.includes(marker.toLowerCase())).toBeTruthy()
    })
  })
})

describe('Photographer Upload brand-only exception (narrow, explicitly approved)', () => {
  const source = readComponent('components/photographer-upload-page-client.jsx')

  it('the header uses the canonical icon component', () => {
    expect(source).toContain('<SnapRoomsIcon className="h-6 w-6 shrink-0" />')
    expect(source).toContain("from '@/components/marketing/logo'")
  })

  it('the destructive/error-state Camera icon is untouched (functional, not brand)', () => {
    expect(source).toContain('<Camera className="h-6 w-6" />')
  })
})

const FUNCTIONAL_CAMERA_SURFACES = [
  'app/admin/page.js',
  'app/dashboard/page.js',
  'app/dashboard/components/event-card.jsx',
  'app/dashboard/components/event-detail-panel.jsx',
  'components/photographers-landing-page.jsx',
  'components/marketing/nav.jsx',
]

describe('generic Camera icon remains allowed only in functional/decorative contexts', () => {
  it.each(FUNCTIONAL_CAMERA_SURFACES)('%s still imports Camera from lucide-react for a legitimate non-brand use', (relPath) => {
    const source = readComponent(relPath)
    expect(source).toContain("from 'lucide-react'")
    expect(source).toMatch(/Camera/)
  })

  it('none of the functional-Camera surfaces pair it with a "SnapRooms" wordmark + home link (that would make it a brand lockup)', () => {
    FUNCTIONAL_CAMERA_SURFACES.forEach((relPath) => {
      const source = readComponent(relPath)
      expect(source).not.toMatch(/<Camera[^>]*\/>\s*<span[^>]*>SnapRooms<\/span>/)
    })
  })
})

describe('QR surfaces are unaffected by the SnapRoomsIcon refactor (still reference the badge, not the mark)', () => {
  it('EventQRModal and the print page still use the full canonical badge', () => {
    const qrModal = readComponent('components/event-qr-modal.jsx')
    const printPage = readComponent('app/event/[slug]/print/page.js')
    expect(qrModal).toContain('/brand/snaprooms-qr-badge.svg')
    expect(printPage).toContain('/brand/snaprooms-qr-badge.svg')
    expect(qrModal).not.toContain('snaprooms-mark.svg')
    expect(printPage).not.toContain('snaprooms-mark.svg')
  })
})
