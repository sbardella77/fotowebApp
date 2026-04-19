import LoginPageClient from './page-client'

export default function LoginPage({ searchParams }) {
  const redirect = searchParams?.redirect ?? '/dashboard'
  return <LoginPageClient redirect={redirect} />
}
