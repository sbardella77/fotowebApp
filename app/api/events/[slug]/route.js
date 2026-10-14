import { getEvent, updateEvent, deleteEvent } from '@/lib/server/event-routes'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `getEvent`/`updateEvent`/`deleteEvent`, dispatched for segments[0] ===
// 'events' with segments.length === 2). Behavior, status codes, and rate
// limiting are unchanged — deliberately no generic try/catch; see the note
// on app/api/uploads/init/route.js for why that matches the original's
// behavior.
//
// getEvent still lives in lib/server/event-routes.js (not inlined here)
// because the admin-session-wrapped GET /api/admin/events/:slug endpoint —
// still served by the catch-all — delegates to the same function.
export async function GET(request, { params }) {
  return getEvent(params.slug)
}

export async function PATCH(request, { params }) {
  return updateEvent(request, params.slug)
}

export async function DELETE(request, { params }) {
  return deleteEvent(request, params.slug)
}
