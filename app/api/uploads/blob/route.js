import { handleBlobUploadTokenRequest } from '@/lib/server/blob-upload-token-route'
import { json } from '@/lib/server/api-response'

export const runtime = 'nodejs'

// Moved out of the legacy app/api/[[...path]]/route.js catch-all (previously
// `issueBlobUploadToken`). The shared implementation now lives in
// lib/server/blob-upload-token-route.js because it is also the handler
// behind /api/owner/events/:slug/private-delivery/blob and
// /api/photographer-upload/:token/blob (both still served from the
// catch-all), which delegate to the exact same logic. No extra try/catch is
// added here beyond what handleBlobUploadTokenRequest already has — matching
// the original, which had no outer generic catch either.
export async function POST(request) {
  return handleBlobUploadTokenRequest(request)
}

export async function OPTIONS() {
  return json({ ok: true })
}
