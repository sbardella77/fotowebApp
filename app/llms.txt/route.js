import { buildLlmsTxt } from '@/lib/seo/llms-txt'

// /llms.txt — see lib/seo/llms-txt.js.
export const dynamic = 'force-static'

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
