import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { APP_UPLOAD_PAGES, buildShareLinks, canShareFiles, fetchPhotoShareFile, isMobileDevice, openFacebookShareDialog, shareFile } from '@/lib/client/share-media'

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

  it('detects phones/tablets (share sheet lists the social apps) vs desktop', () => {
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true)
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' })).toBe(true)
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true) // iPadOS
    expect(isMobileDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false)
    expect(isMobileDevice({ userAgent: 'Windows NT 10.0', userAgentData: { mobile: false } })).toBe(false)
    expect(isMobileDevice(undefined)).toBe(false)
  })

  it('opens the Facebook share dialog as a sized popup on the sharer endpoint', () => {
    const open = vi.fn()
    openFacebookShareDialog('https://snaprooms.app/event/party', { open, screen: { width: 1400, height: 900 } })
    const [href, name, features] = open.mock.calls[0]
    expect(href).toBe('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fsnaprooms.app%2Fevent%2Fparty')
    expect(name).toBe('snaprooms-facebook-share')
    expect(features).toContain('width=600')
  })

  it('points desktop Instagram/TikTok at their upload pages', () => {
    expect(APP_UPLOAD_PAGES.instagram).toBe('https://www.instagram.com/')
    expect(APP_UPLOAD_PAGES.tiktok).toBe('https://www.tiktok.com/upload')
  })

  it('lightbox lists Instagram, TikTok and Facebook as separate targets and prefetches on menu open', () => {
    const src = readFileSync('components/photo-lightbox.jsx', 'utf8')
    for (const channel of ['instagram', 'tiktok', 'facebook']) expect(src).toContain(`channel: '${channel}'`)
    expect(src).toMatch(/onOpenChange=\{\(isOpen\) => \{ if \(isOpen\) prefetchShareFile\(\) \}\}/)
  })
})
