import { NextResponse } from 'next/server'
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/server/owner-auth'
import { ADMIN_COOKIE_NAME, verifyAdminSessionToken } from '@/lib/server/admin-auth'
import { createCsrfToken, verifySameOriginRequest } from '@/lib/server/csrf'

export async function GET(request) {
  const originCheck = verifySameOriginRequest(request)
  if (!originCheck.allowed) {
    return NextResponse.json({ error: originCheck.message, code: originCheck.code }, { status: 403 })
  }

  const ownerToken = request.cookies.get(OWNER_COOKIE_NAME)?.value
  const ownerEmail = ownerToken ? await verifyOwnerSessionToken(ownerToken) : null
  if (ownerEmail) {
    return NextResponse.json({ csrfToken: createCsrfToken(ownerEmail) })
  }

  const adminToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value
  const adminSession = adminToken ? await verifyAdminSessionToken(adminToken) : null
  if (adminSession) {
    return NextResponse.json({ csrfToken: createCsrfToken(`admin:${adminSession.id || adminSession.email || 'session'}`) })
  }

  return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
}
