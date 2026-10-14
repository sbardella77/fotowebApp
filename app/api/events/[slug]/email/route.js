import { saveEventByEmail } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `saveEventByEmail`, dispatched for segments[0] === 'events', segments[2]
// === 'email'). Behavior, status codes, and rate limiting are unchanged.
export async function POST(request, { params }) {
  return saveEventByEmail(request, params.slug)
}
