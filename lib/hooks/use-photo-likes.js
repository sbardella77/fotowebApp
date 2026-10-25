'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Guest hearts for a room. Server state lives in Photo.likeCount (from the
 * photos feed) plus this voter's liked ids (GET /likes); taps are applied
 * optimistically and rolled back if the request fails.
 *
 * `getLikeCount(photo)` overlays the server-confirmed count from the latest
 * toggle on top of the feed value, so a photo shows the right number without
 * refetching the whole page.
 */
export function usePhotoLikes(slug) {
  const [likedIds, setLikedIds] = useState(() => new Set())
  const [counts, setCounts] = useState({})
  const inFlight = useRef(new Set())

  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    fetch(`/api/events/${encodeURIComponent(slug)}/likes`, { credentials: 'same-origin', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { likedPhotoIds: [] }))
      .then((data) => setLikedIds(new Set(data.likedPhotoIds || [])))
      .catch(() => {})
    return () => controller.abort()
  }, [slug])

  const getLikeCount = useCallback(
    (photo) => (photo && counts[photo.id] !== undefined ? counts[photo.id] : photo?.likeCount || 0),
    [counts]
  )

  const toggleLike = useCallback(
    async (photo, forceLiked) => {
      if (!slug || !photo?.id || inFlight.current.has(photo.id)) return
      const wasLiked = likedIds.has(photo.id)
      const nextLiked = forceLiked ?? !wasLiked
      if (nextLiked === wasLiked) return
      const previousCount = getLikeCount(photo)

      inFlight.current.add(photo.id)
      setLikedIds((prev) => {
        const next = new Set(prev)
        nextLiked ? next.add(photo.id) : next.delete(photo.id)
        return next
      })
      setCounts((prev) => ({ ...prev, [photo.id]: Math.max(0, previousCount + (nextLiked ? 1 : -1)) }))

      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photo.id)}/like`,
          { method: nextLiked ? 'PUT' : 'DELETE', credentials: 'same-origin' }
        )
        if (!res.ok) throw new Error(`like failed: ${res.status}`)
        const data = await res.json()
        setCounts((prev) => ({ ...prev, [photo.id]: data.likeCount }))
      } catch (e) {
        console.warn('[likes] toggle failed', e)
        setLikedIds((prev) => {
          const next = new Set(prev)
          wasLiked ? next.add(photo.id) : next.delete(photo.id)
          return next
        })
        setCounts((prev) => ({ ...prev, [photo.id]: previousCount }))
      } finally {
        inFlight.current.delete(photo.id)
      }
    },
    [slug, likedIds, getLikeCount]
  )

  return { likedIds, getLikeCount, toggleLike }
}
