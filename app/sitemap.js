import { LOCALES, localizedPath } from '@/lib/i18n/config'

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://snaprooms.app'

const PUBLIC_PATHS = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/wedding-photo-sharing', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/birthday-photo-sharing', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/private-party-photo-sharing', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/corporate-event-photo-sharing', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/for-wedding-photographers', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/for-event-planners', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/privacy', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/commercial-license', priority: 0.6, changeFrequency: 'monthly' },
]

export default function sitemap() {
  const entries = []

  for (const locale of LOCALES) {
    for (const { path, priority, changeFrequency } of PUBLIC_PATHS) {
      entries.push({
        url: `${baseUrl}${localizedPath(locale, path)}`,
        lastModified: new Date(),
        changeFrequency,
        priority,
      })
    }
  }

  return entries
}
