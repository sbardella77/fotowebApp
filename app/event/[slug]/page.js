import RoomPageClient from '@/components/room-page-client'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { resolveEventSocialImageSafe } from '@/lib/server/event-social-image'

export async function generateMetadata({ params }) {
  const { slug } = params

  let event = null
  let visiblePhotos = []
  try {
    const repository = await getGalleryRepository()
    event = await repository.getEventBySlug(slug)
    if (event) {
      // Raw rows (id/status/displayDerivativeStatus) for
      // resolveEventSocialImageSafe's OWN safe resolution — deliberately
      // NOT event.photos, which is already the guest-safe DTO shape
      // (url pre-resolved, displayDerivativeStatus stripped) and would
      // make this resolver a no-op. Never sent to any client — used only
      // to pick one metadata image URL, server-side.
      visiblePhotos = await repository.getVisiblePhotosForSocialImage(event.id)
    }
  } catch {
    // ignore, event/visiblePhotos stay at their defaults
  }

  if (!event) {
    return { title: 'Room | SnapRooms' }
  }

  const title = `${event.name} | SnapRooms`
  const socialImage = resolveEventSocialImageSafe(event, visiblePhotos)

  return {
    title,
    description: `View and upload photos for ${event.name} on SnapRooms.`,
    openGraph: {
      title,
      description: `View and upload photos for ${event.name} on SnapRooms.`,
      type: 'website',
      images: socialImage
        ? [
            {
              url: socialImage,
              width: 1200,
              height: 630,
              alt: event.name,
            },
          ]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: `View and upload photos for ${event.name} on SnapRooms.`,
      images: socialImage ? [socialImage] : [],
    },
  }
}

export default function EventPage({ params, searchParams }) {
  const { slug } = params
  return <RoomPageClient slug={slug} isNew={searchParams?.new === '1'} />
}
