// Best-effort side-effect called right after a photo upload completes (both
// the Vercel Blob and local-storage paths). Mirrors the ensurePhotoDisplayDerivative
// pattern already used at the same call sites: never throws, never blocks
// the upload response.
export async function incrementPendingPhotoDigest(prisma, eventId) {
  try {
    await prisma.event.update({
      where: { id: eventId },
      data: { pendingDigestPhotoCount: { increment: 1 } },
    })
  } catch (error) {
    console.error('[photo-digest] Failed to increment pending digest count:', { eventId, error: error.message })
  }
}
