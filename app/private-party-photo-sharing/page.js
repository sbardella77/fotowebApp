import { PrivatePartyLandingPage } from '@/components/private-party-landing-page'

export const metadata = {
  title: 'Private Party Photo Sharing — SnapRooms',
  description:
    'The easiest way to collect photos from any private party. Share a QR code, let guests upload instantly — no app, no signup, completely private.',
  alternates: {
    canonical: '/private-party-photo-sharing',
  },
}

export const dynamic = 'force-dynamic'

export default function PrivatePartyPhotoSharing() {
  return <PrivatePartyLandingPage />
}
