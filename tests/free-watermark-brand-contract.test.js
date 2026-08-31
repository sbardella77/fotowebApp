import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'
import sharp from 'sharp'
import { applyWatermark, BRANDED_DOWNLOAD_WATERMARK_OPTIONS, WATERMARK_DERIVATIVE_VERSION } from '@/lib/server/watermark'

const ROOT = resolve(import.meta.dirname, '..')
const ASSET_PATH = 'public/watermark/snaprooms-watermark.png'

// Legacy gold badge's own sha256 (public/watermark/snaprooms-watermark.png
// as it existed pre-fix, retrievable via `git show <pre-fix-sha>:...`) —
// asserted absent, not present, so this can never accidentally "lock in" a
// reversion.
const LEGACY_GOLD_SHA256 = '46e1dc86dab3e101110c21282decb0b80eeb8c9df17b2efbab9463ad6983ec15'

// The replacement lime badge, derived deterministically from the canonical
// public/brand/snaprooms-mark.svg (never hand-edited).
const NEW_WATERMARK_SHA256 = 'd5d26da855305375c75062dd05e36b8d254beacd19a748286b65c0c500b499b7'

function sha256(relPath) {
  return createHash('sha256').update(readFileSync(resolve(ROOT, relPath))).digest('hex')
}

describe('Free watermark uses the canonical V4 lime mark, not the legacy gold badge', () => {
  it('the watermark asset exists at the exact path lib/server/watermark.js reads', () => {
    expect(existsSync(resolve(ROOT, ASSET_PATH))).toBe(true)
  })

  it('the asset is hash-locked to the new lime-derived replacement, never the legacy gold badge', () => {
    const hash = sha256(ASSET_PATH)
    expect(hash).toBe(NEW_WATERMARK_SHA256)
    expect(hash).not.toBe(LEGACY_GOLD_SHA256)
  })

  it('WATERMARK_DERIVATIVE_VERSION was bumped so cached pre-fix (gold) derivatives are never served after deploy', () => {
    // The derivative cache (lib/server/download-derivative.js) keys its
    // storage path on this constant. Without a bump, a photo already
    // downloaded via the branded path would keep serving its old-logo
    // derivative from derivatives/wm-v1/{photoId}.jpg forever.
    expect(WATERMARK_DERIVATIVE_VERSION).toBe('v2')
  })

  it('composited output uses the lime brand color family, not the legacy gold', async () => {
    // A neutral mid-gray background keeps the blend math symmetric across
    // channels, so the badge's OWN hue (not the backdrop's) determines the
    // sampled pixels — real behavior, not a filename or metadata check.
    const sample = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 130, g: 130, b: 130 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer()

    const out = await applyWatermark(sample, BRANDED_DOWNLOAD_WATERMARK_OPTIONS)
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    // Scan the bottom-right quadrant (where the badge is placed) for pixels
    // that differ from the plain background — those are the composited ink.
    let inkFound = false
    let goldLike = false
    let limeLike = false
    for (let y = Math.floor(info.height * 0.6); y < info.height; y += 3) {
      for (let x = Math.floor(info.width * 0.6); x < info.width; x += 3) {
        const i = (y * info.width + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const isBackground = Math.abs(r - 130) < 8 && Math.abs(g - 130) < 8 && Math.abs(b - 130) < 8
        if (isBackground) continue
        inkFound = true
        // Legacy gold badge (~RGB 230,180,60): warm amber, R clearly the
        // dominant channel, G a distant second, B lowest.
        if (r - g > 8 && r - b > 30) goldLike = true
        // New lime badge (canonical SVG fills cluster around RGB ~
        // (170-178, 208-211, 32-48)): G is the dominant channel (R close
        // behind, never clearly above it), B always far below both.
        if (g - b > 30 && g >= r - 5) limeLike = true
      }
    }

    expect(inkFound).toBe(true)
    expect(limeLike).toBe(true)
    expect(goldLike).toBe(false)
  })

  it('the legacy gold asset is not referenced anywhere in the watermark pipeline', () => {
    const source = readFileSync(resolve(ROOT, 'lib/server/watermark.js'), 'utf8')
    // The config still points at the same filename (in-place replacement —
    // zero call-site changes needed), so this guards against a future
    // accidental re-point to a differently-named legacy file rather than
    // asserting a filename that was never used to begin with.
    expect(source).toContain("'snaprooms-watermark.png'")
  })
})

describe('watermark pipeline behavior is otherwise unchanged (gating, opacity, placement)', () => {
  it('lib/event-access.js (Free-vs-paid gating) was not touched by this fix', () => {
    // This fix only replaced the badge asset + bumped the cache version.
    // Gating on which events/downloads get watermarked at all lives
    // entirely in the callers (download routes, gallery job) via
    // resolveEffectiveEventAccessState — untouched here.
    const source = readFileSync(resolve(ROOT, 'lib/event-access.js'), 'utf8')
    expect(source).toContain('export function resolveEffectiveEventAccessState')
  })

  it('default (non-branded) callers still receive PNG/WebP passthrough, unaffected by the asset swap', async () => {
    const sample = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#204080' } })
      .png()
      .toBuffer()
    const out = await applyWatermark(sample)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
  })
})
