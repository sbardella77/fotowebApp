import { getMyPhotoLikes } from '@/lib/server/photo-likes'

export async function GET(request, { params }) {
  return getMyPhotoLikes(request, params.slug)
}
