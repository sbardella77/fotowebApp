import { setPhotoLike } from '@/lib/server/photo-likes'

export async function PUT(request, { params }) {
  return setPhotoLike(request, params.slug, params.photoId, true)
}

export async function DELETE(request, { params }) {
  return setPhotoLike(request, params.slug, params.photoId, false)
}
