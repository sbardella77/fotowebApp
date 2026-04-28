import { BirthdayLandingPage } from '@/components/birthday-landing-page'

export const metadata = {
  title: 'Birthday Photo Sharing with QR Code | SnapRooms',
  description:
    'Collect birthday party photos from every guest in one simple gallery. Share a QR code, let friends upload instantly — no app, no signup.',
  alternates: {
    canonical: '/birthday-photo-sharing',
  },
}

export const dynamic = 'force-dynamic'

export default function BirthdayPhotoSharing() {
  return <BirthdayLandingPage />
}
