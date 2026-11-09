const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://snaprooms.app'

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/event', '/photographer-upload', '/api'],
    },
    // sitemap-legacy.xml is temporary: see app/sitemap-legacy.xml/route.js.
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap-legacy.xml`],
  }
}
