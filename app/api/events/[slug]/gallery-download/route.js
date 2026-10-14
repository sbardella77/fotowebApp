import { createGalleryDownload, getGalleryDownload } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `createGalleryDownload`/`getGalleryDownload`, dispatched for segments[0]
// === 'events', segments[2] === 'gallery-download'). Behavior, status codes,
// and rate limiting are unchanged.
export async function GET(request, { params }) {
  return getGalleryDownload(request, params.slug)
}

export async function POST(request, { params }) {
  return createGalleryDownload(request, params.slug)
}
