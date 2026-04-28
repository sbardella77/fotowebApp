import { TermsPage } from '@/components/terms-page'

export const metadata = {
  title: 'Terms of Service — SnapRooms',
  description:
    'Terms of Service and commercial use terms for SnapRooms. Read our product-ready terms for hosts, photographers, and event professionals.',
  alternates: {
    canonical: '/terms',
  },
}

export const dynamic = 'force-dynamic'

export default function Terms() {
  return <TermsPage />
}
