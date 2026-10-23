import { sendPhotoThresholdReachedEmail } from './owner-notification-emails'

// Best-effort, fire-once-per-event notification for an owner whose event
// just hit its Free-plan photo limit. Called from both upload-complete
// branches (local + Vercel Blob), at the same point where
// EVENT_FREE_PHOTO_LIMIT_HIT analytics already fires.
//
// The photoThresholdNotifiedAt flag is set before sending the email (not
// after) — same optimistic-claim idea as the idempotency guards elsewhere
// in the upload flow: a failed/slow send should never retry on every
// subsequent upload attempt against an already-full room.
export async function notifyPhotoThresholdReachedOnce(prisma, { eventId, max, appUrl }) {
  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, slug: true, name: true, ownerId: true, photoThresholdNotifiedAt: true },
    })

    if (!event || event.photoThresholdNotifiedAt || !event.ownerId) {
      return
    }

    const owner = await prisma.owner.findUnique({
      where: { id: event.ownerId },
      select: { id: true, email: true, emailNotificationsEnabled: true },
    })

    if (!owner) {
      return
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { photoThresholdNotifiedAt: new Date() },
    })

    if (owner.emailNotificationsEnabled) {
      await sendPhotoThresholdReachedEmail({ owner, event, max, appUrl })
    }
  } catch (error) {
    console.error('[photo-threshold-notification] Failed:', { eventId, error: error.message })
  }
}
