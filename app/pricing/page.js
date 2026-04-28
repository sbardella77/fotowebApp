import { PricingPage } from '@/components/pricing-page'

export const metadata = {
  title: 'Pricing — SnapRooms',
  description:
    'Simple pricing for every kind of event. Guests always upload for free. Pay per event for personal occasions, or monthly as a professional.',
  alternates: {
    canonical: '/pricing',
  },
}

export const dynamic = 'force-dynamic'

export default async function Pricing() {
  return <PricingPage />
}
