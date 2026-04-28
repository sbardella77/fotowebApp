import { CommercialLicensePage } from '@/components/commercial-license-page'

export const metadata = {
  title: 'Commercial License & Professional Terms — SnapRooms',
  description:
    'Commercial use terms for photographers, planners, venues, and agencies using SnapRooms as part of their professional services.',
  alternates: {
    canonical: '/commercial-license',
  },
}

export const dynamic = 'force-dynamic'

export default function CommercialLicense() {
  return <CommercialLicensePage />
}
