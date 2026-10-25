import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { buildShareLinks, canShareFiles, fetchPhotoShareFile, shareFile } from '@/lib/client/share-media'

const file = new File([new Blob(['x'], { type: 'image/jpeg' })], 'a.jpg', { type: 'image/jpeg' })

describe('share-media', () => {
  it('builds encoded link-share URLs', () => {
    const links = buildShareLinks({ pageUrl: 'https://snaprooms.app/event/a b', text: 'Party & co' })
    expect(links.facebook).toBe('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fsnaprooms.app%2Fevent%2Fa%20b')
    expect(links.whatsapp).toContain('Party%20%26%20co%20https%3A')
    expect(links.x).toContain('&text=Party%20%26%20co')
  })

  it('reports no file sharing without the Web Share API', () => {
    expect(canShareFiles(undefined)).toBe(false)
    expect(canShareFiles({ share: () => {} })).toBe(false)
    expect(canShareFiles({ share: () => {}, canShare: () => true })).toBe(true)
  })

  it('fetches the standard rendition, never photo.url or the original', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/jpeg' }) }))
    const f = await fetchPhotoShareFile('p1', fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/api/download/photo?photoId=p1&type=standard')
    expect(f.name).toBe('snaprooms-p1.jpeg')
  })

  it('maps share outcomes', async () => {
    const nav = (err) => ({ canShare: () => true, share: vi.fn(async () => { if (err) throw Object.assign(new Error(), { name: err }) }) })
    expect(await shareFile(file, { nav: nav() })).toBe('shared')
    expect(await shareFile(file, { nav: nav('AbortError') })).toBe('cancelled')
    expect(await shareFile(file, { nav: nav('NotAllowedError') })).toBe('needs-gesture')
    expect(await shareFile(file, { nav: {} })).toBe('unsupported')
  })

  it('lightbox shares via the download endpoint helper, not photo.url', () => {
    const src = readFileSync('components/photo-lightbox.jsx', 'utf8')
    expect(src).toContain('fetchPhotoShareFile(photo.id)')
    expect(src).not.toMatch(/share[^\n]*photo\.url/i)
  })
})
