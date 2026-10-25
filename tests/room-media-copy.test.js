import { describe, it, expect } from 'vitest'
import { dictionaries } from '@/lib/i18n/dictionaries'
import { withMediaCopy } from '@/lib/room-copy'

const locales = Object.keys(dictionaries)
const enKeys = Object.keys(dictionaries.en.room.withVideo).sort()

describe('room photo/video copy', () => {
  it('keeps photo-only copy in Free rooms and switches to photos & videos where videos are allowed', () => {
    const it_ = dictionaries.it.room
    expect(withMediaCopy(it_, false).addYourPhotos).toBe('Aggiungi le tue foto')
    expect(withMediaCopy(it_, true).addYourPhotos).toBe('Aggiungi le tue foto e video')
    expect(withMediaCopy(it_, true).photosLabel).toBe('foto e video')
    // Strings that are genuinely photo-only stay untouched in paid rooms.
    expect(withMediaCopy(it_, true).freeLimitReached).toBe(it_.freeLimitReached)
  })

  it.each(locales)('%s defines every withVideo override, each mentioning video', (locale) => {
    const room = dictionaries[locale].room
    expect(Object.keys(room.withVideo).sort()).toEqual(enKeys)
    for (const key of enKeys) {
      expect(typeof room[key]).toBe('string') // overrides an existing base key
      expect(room.withVideo[key]).toMatch(/vid|víd|file|Datei|archivo|arquivo|fichier/i)
    }
  })

  it.each(locales)('%s keeps {placeholders} intact in overrides', (locale) => {
    const room = dictionaries[locale].room
    for (const key of enKeys) {
      const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort()
      expect(placeholders(room.withVideo[key])).toEqual(placeholders(room[key]))
    }
  })
})
