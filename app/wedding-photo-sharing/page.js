import { WeddingLandingPage } from '@/components/wedding-landing-page'

export const metadata = {
  title: 'Wedding Photo Sharing with QR Code | SnapRooms',
  description:
    'Collect wedding guest photos in one simple room. Share a QR code, let guests upload instantly, and keep every moment together — no app, no signup.',
  alternates: {
    canonical: '/wedding-photo-sharing',
  },
}

export default function WeddingPhotoSharingPage() {
  return <WeddingLandingPage />
}
