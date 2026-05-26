import { NextResponse } from 'next/server'
import { getPrismaClient } from '@/lib/server/prisma-client'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { jobId } = params
  const prisma = await getPrismaClient()

  if (!prisma) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 })
  }

  const job = await prisma.galleryDownloadJob.findUnique({
    where: { id: jobId },
  })

  if (!job) {
    return NextResponse.json({ error: 'Download not found' }, { status: 404 })
  }

  if (job.status !== 'READY' || !job.resultUrl) {
    return NextResponse.json(
      { error: 'Gallery download is not ready yet', status: job.status },
      { status: 409 }
    )
  }

  return NextResponse.redirect(job.resultUrl)
}
