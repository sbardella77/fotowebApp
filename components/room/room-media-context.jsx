'use client'

import { createContext, useContext, useMemo } from 'react'
import { useTranslations } from '@/components/i18n-provider'
import { withMediaCopy } from '@/lib/room-copy'

// Whether the current room accepts videos. Provided by the room page;
// anywhere else (dashboard, marketing) it defaults to photo-only copy.
export const RoomMediaContext = createContext(false)

export function useRoomCopy() {
  const roomCopy = useTranslations('room')
  const videosAllowed = useContext(RoomMediaContext)
  return useMemo(() => withMediaCopy(roomCopy, videosAllowed), [roomCopy, videosAllowed])
}
