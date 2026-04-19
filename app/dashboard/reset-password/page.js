import ResetPasswordPageClient from './page-client'

export default function ResetPasswordPage({ searchParams }) {
  const token = searchParams?.token ?? ''
  return <ResetPasswordPageClient token={token} />
}
