import { PlannersLandingPage } from '@/components/planners-landing-page'

export const metadata = {
  title: 'Event Photo Collection for Planners — SnapRooms',
  description:
    'One dashboard for every event you plan. Collect guest photos instantly with QR codes, manage multiple rooms, and deliver galleries to clients.',
  alternates: {
    canonical: '/for-event-planners',
  },
}

export const dynamic = 'force-dynamic'

export default function ForEventPlanners() {
  return <PlannersLandingPage />
}
