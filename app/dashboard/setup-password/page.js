import SetupPasswordPageClient from './page-client'

export default function SetupPasswordPage({ searchParams }) {
  const token = searchParams?.token ?? ''
  return <SetupPasswordPageClient token={token} />
}
