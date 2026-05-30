import RoomPageClient from '@/components/room-page-client'
import { getGalleryRepository } from '@/lib/server/gallery-repository'
import { resolveEventSocialImage } from '@/lib/server/event-social-image'

export async function generateMetadata({ params }) {
  const { slug } = params

  let event = null
  try {
    const repository = await getGalleryRepository()
    event = await repository.getEventBySlug(slug)
  } catch {
    // ignore, event stays null
  }

  if (!event) {
    return { title: 'Room | SnapRooms' }
  }

  const title = `${event.name} | SnapRooms`
  const socialImage = resolveEventSocialImage(event, event.photos || [])

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
