import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { buildZipVideoNote, MAX_ZIP_VIDEOS, selectZipVideos } from '@/lib/server/gallery-zip-videos'

const MB = 1024 * 1024
const v = (id, size, extra = {}) => ({ id, originalName: `${id}.mov`, size, videoStatus: 'READY', muxPlaybackId: `pb${id}0123456789`, ...extra })

describe('selectZipVideos', () => {
  it('includes READY videos as Mux MP4 renditions, never the original', () => {
    const { included } = selectZipVideos([v('a', 10 * MB)])
    expect(included[0].sourceUrl).toBe('https://stream.mux.com/pba0123456789/highest.mp4')
  })

  it('keeps processing/failed videos out and reports them', () => {
    const { included, notReady } = selectZipVideos([v('a', MB), v('b', MB, { videoStatus: 'PROCESSING' }), v('c', MB, { muxPlaybackId: null })])
    expect(included.map((x) => x.id)).toEqual(['a'])
    expect(notReady.map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('enforces the count and byte caps, newest first', () => {
    const many = Array.from({ length: MAX_ZIP_VIDEOS + 3 }, (_, i) => v(`v${i}`, MB))
    expect(selectZipVideos(many).included).toHaveLength(MAX_ZIP_VIDEOS)
    const { included, skipped } = selectZipVideos([v('a', 60 * MB), v('b', 50 * MB), v('c', 10 * MB)], { maxBytes: 100 * MB })
    expect(included.map((x) => x.id)).toEqual(['a', 'c'])
    expect(skipped.map((x) => x.id)).toEqual(['b'])
  })

  it('writes a note only when something was left out', () => {
    expect(buildZipVideoNote({ skipped: [], notReady: [] })).toBeNull()
    const note = buildZipVideoNote({ skipped: [v('big', MB)], notReady: [v('new', MB)] })
    expect(note).toContain('big.mov')
    expect(note).toContain('new.mov')
  })
})

describe('gallery ZIP route', () => {
  const src = readFileSync('app/api/download/gallery/route.js', 'utf8')

  it('streams with backpressure and stores videos uncompressed', () => {
    expect(src).toContain('Readable.toWeb(archive)')
    expect(src).not.toContain("archive.on('data'")
    expect(src).toMatch(/store: true/)
  })

  it('has a time budget sized for videos', () => {
    expect(src).toMatch(/export const maxDuration = 300/)
  })
})
