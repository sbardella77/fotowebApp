import { describe, it, expect, vi, beforeEach } from 'vitest'
import { incrementPendingPhotoDigest } from '@/lib/server/photo-digest'

describe('incrementPendingPhotoDigest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('increments pendingDigestPhotoCount for the given event', async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = { event: { update } }

    await incrementPendingPhotoDigest(prisma, 'event_1')

    expect(update).toHaveBeenCalledWith({
      where: { id: 'event_1' },
      data: { pendingDigestPhotoCount: { increment: 1 } },
    })
  })

  it('never throws when the update fails', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db unreachable'))
    const prisma = { event: { update } }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(incrementPendingPhotoDigest(prisma, 'event_1')).resolves.toBeUndefined()
  })
})
