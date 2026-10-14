import { listEvents, createEvent } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `listEvents`/`createEvent`, dispatched for segments[0] === 'events' with
// segments.length === 1). Behavior, status codes, and rate limiting are
// unchanged — deliberately no generic try/catch; see the note on
// app/api/uploads/init/route.js for why that matches the original's
// behavior (errors propagate as a rejection, exactly like before).
//
// listEvents/createEvent still live in lib/server/event-routes.js (not
// inlined here) because the admin-session-wrapped GET/POST /api/admin/events
// endpoints — still served by the catch-all — delegate to these same two
// functions to share their exact PUBLIC response shape and CORS stripping.
export async function GET() {
  return listEvents()
}

export async function POST(request) {
  return createEvent(request)
}
