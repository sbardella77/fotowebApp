import RoomPageClient from '@/components/room-page-client'

export default function EventPage({ params }) {
  const { slug } = params
  return <RoomPageClient slug={slug} />
}
