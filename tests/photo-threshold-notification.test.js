import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendPhotoThresholdReachedEmail } = vi.hoisted(() => ({
  sendPhotoThresholdReachedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))
vi.mock('@/lib/server/owner-notification-emails', () => ({ sendPhotoThresholdReachedEmail }))

import { notifyPhotoThresholdReachedOnce } from '@/lib/server/photo-threshold-notification'

function buildPrisma({ event, owner }) {
  return {
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
      update: vi.fn().mockResolvedValue({}),
    },
    owner: {
      findUnique: vi.fn().mockResolvedValue(owner),
    },
  }
}

describe('notifyPhotoThresholdReachedOnce', () => {
  beforeEach(() => {
    sendPhotoThresholdReachedEmail.mockClear()
    sendPhotoThresholdReachedEmail.mockResolvedValue({ sent: true })
  })

  it('sends the email and sets photoThresholdNotifiedAt on first call', async () => {
    const prisma = buildPrisma({
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding', ownerId: 'owner_1', photoThresholdNotifiedAt: null },
      owner: { id: 'owner_1', email: 'owner@example.com', emailNotificationsEnabled: true },
    })

    await notifyPhotoThresholdReachedOnce(prisma, { eventId: 'event_1', max: 50, appUrl: 'https://snaprooms.app' })

    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { photoThresholdNotifiedAt: expect.any(Date) },
    })
    expect(sendPhotoThresholdReachedEmail).toHaveBeenCalledTimes(1)
    expect(sendPhotoThresholdReachedEmail.mock.calls[0][0].max).toBe(50)
  })

  it('is a no-op if the event was already notified', async () => {
    const prisma = buildPrisma({
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding', ownerId: 'owner_1', photoThresholdNotifiedAt: new Date() },
      owner: { id: 'owner_1', email: 'owner@example.com', emailNotificationsEnabled: true },
    })

    await notifyPhotoThresholdReachedOnce(prisma, { eventId: 'event_1', max: 50, appUrl: 'https://snaprooms.app' })

    expect(prisma.event.update).not.toHaveBeenCalled()
    expect(sendPhotoThresholdReachedEmail).not.toHaveBeenCalled()
  })

  it('does not send the email if the owner disabled notifications, but still marks notified', async () => {
    const prisma = buildPrisma({
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding', ownerId: 'owner_1', photoThresholdNotifiedAt: null },
      owner: { id: 'owner_1', email: 'owner@example.com', emailNotificationsEnabled: false },
    })

    await notifyPhotoThresholdReachedOnce(prisma, { eventId: 'event_1', max: 50, appUrl: 'https://snaprooms.app' })

    expect(prisma.event.update).toHaveBeenCalledOnce()
    expect(sendPhotoThresholdReachedEmail).not.toHaveBeenCalled()
  })

  it('is a no-op if the event has no owner', async () => {
    const prisma = buildPrisma({
      event: { id: 'event_1', slug: 'wedding-2025', name: 'Wedding', ownerId: null, photoThresholdNotifiedAt: null },
      owner: null,
    })

    await notifyPhotoThresholdReachedOnce(prisma, { eventId: 'event_1', max: 50, appUrl: 'https://snaprooms.app' })

    expect(prisma.event.update).not.toHaveBeenCalled()
    expect(sendPhotoThresholdReachedEmail).not.toHaveBeenCalled()
  })

  it('never throws when the database lookup fails', async () => {
    const prisma = {
      event: { findUnique: vi.fn().mockRejectedValue(new Error('db down')), update: vi.fn() },
      owner: { findUnique: vi.fn() },
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      notifyPhotoThresholdReachedOnce(prisma, { eventId: 'event_1', max: 50, appUrl: 'https://snaprooms.app' }),
    ).resolves.toBeUndefined()
  })
})
