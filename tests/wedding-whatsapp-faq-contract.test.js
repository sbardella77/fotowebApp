import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { dictionaries } from '@/lib/i18n/dictionaries'

const ROOT = resolve(import.meta.dirname, '..')
const AUTHORIZED_LOCALES = ['it', 'en', 'de', 'es']

function readComponent(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

const FORBIDDEN_CLAIM_PATTERNS = [
  /lossless/i,
  /uncompressed/i,
  /original quality/i,
  /unlimited/i,
  /GDPR/i,
  /\bbest\b/i,
  /#1/,
  /better (image )?quality than whatsapp/i,
  /more secure than whatsapp/i,
  /no participant limit/i,
]

describe('Wedding page — WhatsApp comparison FAQ (7th FAQ, SEO Wedding Landing Optimization V1)', () => {
  const source = readComponent('components/wedding-landing-page.jsx')

  it('FAQ accordion renders a 7th item (faq7) after the existing 6', () => {
    expect(source).toContain('t.faq6Question')
    expect(source).toContain('t.faq6Answer')
    expect(source).toContain('t.faq7Question')
    expect(source).toContain('t.faq7Answer')
  })

  it.each(AUTHORIZED_LOCALES)('%s has a non-empty faq7Question and faq7Answer', (locale) => {
    const w = dictionaries[locale].wedding
    expect(typeof w.faq7Question).toBe('string')
    expect(w.faq7Question.length).toBeGreaterThan(0)
    expect(typeof w.faq7Answer).toBe('string')
    expect(w.faq7Answer.length).toBeGreaterThan(0)
  })

  it.each(AUTHORIZED_LOCALES)('%s faq7Question mentions WhatsApp descriptively', (locale) => {
    expect(dictionaries[locale].wedding.faq7Question.toLowerCase()).toContain('whatsapp')
  })

  it('FR wedding namespace is untouched — out of scope for this task', () => {
    expect(dictionaries.fr.wedding.faq7Question).toBeUndefined()
    expect(dictionaries.fr.wedding.faq7Answer).toBeUndefined()
  })

  it.each(AUTHORIZED_LOCALES)('%s faq7Answer contains no unverified/forbidden claim', (locale) => {
    const answer = dictionaries[locale].wedding.faq7Answer
    for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
      expect(answer, `faq7Answer for ${locale} matched forbidden pattern ${pattern}`).not.toMatch(pattern)
    }
  })

  it.each(AUTHORIZED_LOCALES)('%s faq1-faq6 remain present and unchanged in count (no duplication)', (locale) => {
    const w = dictionaries[locale].wedding
    for (let i = 1; i <= 6; i++) {
      expect(typeof w[`faq${i}Question`]).toBe('string')
      expect(typeof w[`faq${i}Answer`]).toBe('string')
    }
    expect(w.faq8Question).toBeUndefined()
  })

  it('primary CTA (create-event form) and secondary Pricing CTA are still present (no regression)', () => {
    expect(source).toContain('{t.finalCta}')
    expect(source).toContain('createEvent')
    expect(source).toContain("localizedPath(locale, '/pricing')")
    expect(source).toContain('{t.viewPricing}')
  })

  it('no new WhatsApp-branded section/component was introduced beyond the FAQ item', () => {
    const whatsappMentions = (source.match(/whatsapp/gi) || []).length
    // Exactly one reference: the faq7 wiring itself (t.faq7Question / t.faq7Answer do not
    // contain the literal word "WhatsApp" in JSX — the string lives in the dictionary).
    // This guards against someone adding a dedicated <WhatsAppComparison /> component,
    // a comparison table, or a second WhatsApp-branded block to this file.
    expect(whatsappMentions).toBe(0)
  })
})

describe('DE Wedding Title/H1 — lexical optimization (SnapRooms DE Wedding SEO V1)', () => {
  it('de.meta.weddingTitle matches the approved search-led wording', () => {
    expect(dictionaries.de.meta.weddingTitle).toBe('Hochzeitsfotos sammeln & teilen — SnapRooms')
  })

  it('de.wedding.heroHeadline1/heroHeadline2 render the approved H1 with correct du-register', () => {
    expect(dictionaries.de.wedding.heroHeadline1).toBe('Alle Hochzeitsfotos deiner Gäste sammeln')
    expect(dictionaries.de.wedding.heroHeadline2).toBe('— ganz einfach')
    expect(dictionaries.de.wedding.heroHeadline1 + ' ' + dictionaries.de.wedding.heroHeadline2).toBe(
      'Alle Hochzeitsfotos deiner Gäste sammeln — ganz einfach'
    )
    // Register guard: must use "deiner" (du-form), never "eurer" (ihr-form) — the rest of
    // the page is consistently du-addressed (Sammle.../Teile.../Erstelle dein...).
    expect(dictionaries.de.wedding.heroHeadline1).not.toMatch(/eurer/)
  })

  it('de.meta.weddingDescription (meta description) is unchanged', () => {
    expect(dictionaries.de.meta.weddingDescription).toBe(
      'Sammle alle Gästefotos deiner Hochzeit in einer wunderschönen Galerie. Keine App nötig — einfach Link oder QR-Code teilen.'
    )
  })

  it('de.wedding.heroEyebrow and heroSubheadline are unchanged (out of scope this task)', () => {
    expect(dictionaries.de.wedding.heroEyebrow).toBe('Hochzeits-Fotosharing')
    expect(dictionaries.de.wedding.heroSubheadline).toBe(
      'Sammle jedes Gästefoto in einer wunderschönen Galerie. Teile einen QR-Code, lass Gäste sofort hochladen und bewahre jeden Moment — keine App, keine Anmeldung.'
    )
  })

  it('de.wedding.faq7Question (WhatsApp FAQ) is unchanged', () => {
    expect(dictionaries.de.wedding.faq7Question).toBe('Warum nicht einfach eine WhatsApp-Gruppe nutzen?')
  })
})

describe('IT/EN/ES Wedding Title/H1 — must remain unchanged (out of scope this task)', () => {
  it('it.meta.weddingTitle and hero are unchanged', () => {
    expect(dictionaries.it.meta.weddingTitle).toBe('Condivisione Foto Matrimonio — SnapRooms')
    expect(dictionaries.it.wedding.heroHeadline1).toBe('Condivisione foto matrimonio')
    expect(dictionaries.it.wedding.heroHeadline2).toBe('semplice')
  })

  it('en.meta.weddingTitle and hero are unchanged', () => {
    expect(dictionaries.en.meta.weddingTitle).toBe('Wedding Photo Sharing — SnapRooms')
    expect(dictionaries.en.wedding.heroHeadline1).toBe('Wedding photo sharing')
    expect(dictionaries.en.wedding.heroHeadline2).toBe('made simple')
  })

  it('es.meta.weddingTitle and hero are unchanged', () => {
    expect(dictionaries.es.meta.weddingTitle).toBe('Compartir Fotos de Boda — SnapRooms')
    expect(dictionaries.es.wedding.heroHeadline1).toBe('Compartir fotos de boda')
    expect(dictionaries.es.wedding.heroHeadline2).toBe('hecho simple')
  })
})
