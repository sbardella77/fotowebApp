import { initVideoUpload } from '@/lib/server/video-uploads'

export const runtime = 'nodejs'

export async function POST(request) {
  return initVideoUpload(request)
}
