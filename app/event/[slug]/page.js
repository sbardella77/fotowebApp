import { redirect } from 'next/navigation'

// Server-side redirect from /event/SLUG to /?event=SLUG
// This preserves the canonical URL structure for QR codes while
// maintaining backward compatibility with the existing query-param loading
export default function EventRedirectPage({ params }) {
  const { slug } = params
  redirect(`/?event=${slug}`)
}
