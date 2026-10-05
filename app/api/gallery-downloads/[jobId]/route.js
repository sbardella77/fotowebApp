import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Legacy Gallery ZIP download capability — permanently retired.
 *
 * This endpoint used to look up a GalleryDownloadJob by jobId alone and
 * redirect to its public Blob resultUrl (IDOR). It now answers 410 Gone for
 * every request without touching the database or Blob storage, so a real
 * jobId and a random one are indistinguishable and nothing is disclosed.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'This download link is no longer available.', code: 'gone' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } }
  )
}
