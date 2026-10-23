import { trackRoomView } from '@/lib/server/event-routes'

export async function POST(request, { params }) {
  return trackRoomView(request, params.slug)
}
