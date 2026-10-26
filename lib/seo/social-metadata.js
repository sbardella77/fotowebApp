import { LOCALES } from '@/lib/i18n/config'

/**
 * Open Graph / Twitter card metadata for the localized marketing pages.
 *
 * Every marketing page.js already builds its own title, description and
 * alternates (canonical + hreflang) block; this wraps that object and derives
 * the social tags from it, so og:url can never drift from the canonical and a
 * shared link previews with the same title/description Google shows.
 *
 * The preview image is app/[locale]/opengraph-image.js. Next only attaches a
 * file-based image to its own segment (/[locale]); a child page that sets
 * `openGraph` replaces it, so the image URL is declared here explicitly.
 */
export const OG_LOCALE = {
  en: 'en_US',
  de: 'de_DE',
  it: 'it_IT',
  fr: 'fr_FR',
  es: 'es_ES',
  'pt-BR': 'pt_BR',
}

export function withSocialMetadata(locale, metadata) {
  const { title, description, alternates } = metadata
  const images = [{ url: `/${locale}/opengraph-image`, width: 1200, height: 630, alt: 'SnapRooms' }]
  return {
    ...metadata,
    openGraph: {
      type: 'website',
      siteName: 'SnapRooms',
      title,
      description,
      url: alternates?.canonical,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images,
    },
  }
}
