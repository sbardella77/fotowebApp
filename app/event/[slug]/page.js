import RoomPageClient from '@/components/room-page-client'

export default function EventPage({ params, searchParams }) {
  const { slug } = params
  return <RoomPageClient slug={slug} isNew={searchParams?.new === '1'} />
}
