import { handleMuxWebhook } from '@/lib/server/video-uploads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handleMuxWebhook(request)
}
