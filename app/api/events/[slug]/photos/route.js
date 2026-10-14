import { getEventPhotos } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `getEventPhotos`, dispatched for segments[0] === 'events', segments[2] ===
// 'photos'). Behavior, status codes, and rate limiting are unchanged.
export async function GET(request, { params }) {
  return getEventPhotos(request, params.slug)
}
