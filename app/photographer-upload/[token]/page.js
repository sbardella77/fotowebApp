import PhotographerUploadPageClient from '@/components/photographer-upload-page-client'

export const metadata = {
  title: 'Private Upload — SnapRooms',
  description: 'Secure private upload for professional files.',
}

export default function PhotographerUploadPage({ params }) {
  const { token } = params
  return <PhotographerUploadPageClient token={token} />
}
