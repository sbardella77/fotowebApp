const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://fotoweb-app.vercel.app'

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/event', '/api'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
