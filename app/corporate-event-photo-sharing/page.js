import { CorporateLandingPage } from '@/components/corporate-landing-page'

export const metadata = {
  title: 'Corporate Event Photo Collection — SnapRooms',
  description:
    'Collect attendee photos from conferences, offsites, and company events with a simple QR code. No app installs, no IT setup, instant galleries.',
  alternates: {
    canonical: '/corporate-event-photo-sharing',
  },
}

export const dynamic = 'force-dynamic'

export default function CorporateEventPhotoSharing() {
  return <CorporateLandingPage />
}
