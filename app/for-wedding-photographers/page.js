import { PhotographersLandingPage } from '@/components/photographers-landing-page'

export const metadata = {
  title: 'Wedding Photo Sharing for Photographers — SnapRooms',
  description:
    'Offer private photo collection as part of your wedding photography packages. Guests upload instantly via QR code — no app, no signup. Built for professionals.',
  alternates: {
    canonical: '/for-wedding-photographers',
  },
}

export const dynamic = 'force-dynamic'

export default function ForWeddingPhotographers() {
  return <PhotographersLandingPage />
}
