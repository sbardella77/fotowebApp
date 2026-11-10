const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || 'https://snaprooms.app'

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // /photographer-upload is deliberately NOT disallowed: its pages carry
      // noindex (app/photographer-upload/layout.js), and Google can only read
      // a noindex on a page it is allowed to crawl.
      disallow: ['/dashboard', '/admin', '/event', '/api'],
    },
    // sitemap-legacy.xml is temporary: see app/sitemap-legacy.xml/route.js.
    sitemap: [`${baseUrl}/sitemap.xml`, `${baseUrl}/sitemap-legacy.xml`],
  }
}
