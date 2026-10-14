import { saveEventOwner } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `saveEventOwner`, dispatched for segments[0] === 'events', segments[2] ===
// 'owner'). Behavior, status codes, and rate limiting are unchanged.
export async function POST(request, { params }) {
  return saveEventOwner(request, params.slug)
}
