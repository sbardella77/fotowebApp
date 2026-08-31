import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const ASSET_DIR = 'public/marketing-placeholder'
const CREDITS = readFileSync(resolve(ROOT, ASSET_DIR, 'CREDITS.md'), 'utf8')

function sha256(relPath) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, relPath))).digest('hex')
}

// Hash-locks the replacement files this remediation introduced, so a future
// accidental revert (or a well-meaning "optimize these images" pass) can't
// silently reintroduce the unresolved-provenance originals under the same
// filenames without a test failure.
const EXPECTED_HASHES = {
  'wedding-couple.jpg': 'c7112fcd781a3c96d09e66d182036b9c1b1ff3df181342d7abcd795e3b434f58',
  'wedding-couple-thumb.jpg': '0aeda963647976ac38bafaeea718508c030ae562fb6d9059ab5d39a67c269a51',
  'wedding-couple-card.jpg': '59193689a29c86722d0fac76ef8004a0dc171ab5eeb8cfcfa763ce1e2d80b96e',
  'wedding-guests.jpg': 'c0147b9a3c85ae2e1ac98aac86d8794ca98586a3ca9ae63419b9c0b65af13342',
  'wedding-guests-thumb.jpg': 'fece7d78e2dbf103ef4ba98a9166b1581907c893edfcce955006006b37a04c75',
  'wedding-detail.jpg': 'b63aac72fde8ba8aa954d1e3bc4528cf72284369c44d226e678be0f738b3ec31',
  'wedding-detail-thumb.jpg': '5009f502ac7eab7ba61d8cb26798a8147d76e2c95f019ca76acc20b18dcccb3f',
  'wedding-detail-square.jpg': 'a6225d5f30e6a38914cc53a9bfd55c4b8e243edecd4f83560af08d3cadcd5974',
  'wedding-group.jpg': '432fedec8a51d5349c5b0ea5da048bc0871ea3ef7048b640ef750613e96fff71',
  'wedding-group-thumb.jpg': '0fd92b12df291b849b9af6a1927dd2a16ad4307d3701204642adff770ac8dd36',
  'wedding-toast.jpg': '90c2ffbe7b0d3072b74176f47e071a3d3fe2318dc56dc37016d04cc239c168bf',
  'wedding-toast-thumb.jpg': '45791d9f91bcb0a1952ddbb53079c000a671804914bb7b0e9bb9e5bb08a601e9',
}

describe('wedding asset provenance remediation — the 5 unresolved originals and their derivatives', () => {
  it.each(Object.entries(EXPECTED_HASHES))('%s matches the approved replacement (hash-locked)', (file, hash) => {
    expect(existsSync(resolve(ROOT, ASSET_DIR, file))).toBe(true)
    expect(sha256(`${ASSET_DIR}/${file}`)).toBe(hash)
  })

  it('CREDITS.md no longer lists any wedding-* file as SOURCE METADATA MISSING', () => {
    const weddingRows = CREDITS.split('\n').filter((line) => /^\|\s*`wedding-(couple|guests|detail|group|toast)\.jpg`/.test(line))
    expect(weddingRows.length).toBeGreaterThan(0)
    weddingRows.forEach((row) => {
      expect(row).not.toContain('SOURCE METADATA MISSING')
    })
  })

  it('CREDITS.md records full attribution (source URL, photographer, provider, license) for all 5 replacements', () => {
    expect(CREDITS).toContain('Bruna Fossile')
    expect(CREDITS).toContain('Karolina Grabowska')
    expect(CREDITS).toContain('Faruk Tokluoğlu')
    expect(CREDITS).toMatch(/Taha Samet Arslan/g)
    expect(CREDITS).toContain('pexels.com/photo/34410635')
    expect(CREDITS).toContain('pexels.com/photo/15530652')
    expect(CREDITS).toContain('pexels.com/photo/6165')
    expect(CREDITS).toContain('pexels.com/photo/15530616')
    expect(CREDITS).toContain('pexels.com/photo/11350576')
  })

  it('every render site still references the same filenames — zero code churn from this remediation', () => {
    const renderSites = [
      'components/landing-page.jsx',
      'components/wedding-landing-page.jsx',
      'components/photographers-landing-page.jsx',
      'components/private-party-landing-page.jsx',
      'components/birthday-landing-page.jsx',
      'components/planners-landing-page.jsx',
      'components/marketing/phone-mockup.jsx',
      'components/marketing/problem-section.jsx',
    ]
    renderSites.forEach((relPath) => {
      const source = readFileSync(resolve(ROOT, relPath), 'utf8')
      expect(source).not.toMatch(/wedding-(couple|guests|detail|group|toast)-v2|wedding-(couple|guests|detail|group|toast)-new/)
    })
  })
})
