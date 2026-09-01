import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'
import sharp from 'sharp'

const ROOT = resolve(import.meta.dirname, '..')
const ASSET_PATH = 'public/favicon.png'

// The pre-fix asset's own sha256 (32x32, mismatched against its own
// declared metadata size) — asserted absent, not present, so this can
// never accidentally "lock in" a reversion of the dimension fix.
const PRE_FIX_32X32_SHA256 = '254db051ace814e776c84106428fdbf22cb4cefd66b203590cbe612f5fb007e4'

describe('favicon.png matches its declared 48x48 metadata contract', () => {
  it('the asset file exists', () => {
    expect(existsSync(resolve(ROOT, ASSET_PATH))).toBe(true)
  })

  it('is exactly 48x48, not the pre-fix 32x32 mismatch', async () => {
    const meta = await sharp(resolve(ROOT, ASSET_PATH)).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(48)
    expect(meta.height).toBe(48)
  })

  it('is not the pre-fix 32x32 asset (regression guard)', () => {
    const buf = readFileSync(resolve(ROOT, ASSET_PATH))
    const hash = createHash('sha256').update(buf).digest('hex')
    expect(hash).not.toBe(PRE_FIX_32X32_SHA256)
  })

  it('app/layout.js still declares favicon.png as 48x48 (metadata/asset stay in sync)', () => {
    const layoutSource = readFileSync(resolve(ROOT, 'app/layout.js'), 'utf8')
    expect(layoutSource).toContain("{ url: '/favicon.png', sizes: '48x48', type: 'image/png' }")
  })
})
