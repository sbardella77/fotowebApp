/**
 * Room copy that mentions videos only where videos can actually be added.
 *
 * Videos are a paid-room capability (enforced server-side in
 * lib/server/video-uploads.js), so Free rooms must keep saying "photos" —
 * promising videos there would invite uploads the server then refuses. The
 * dictionary's `room.withVideo` block holds the "photos & videos" variants
 * of the affected strings and is layered over the base copy on demand.
 */
export function withMediaCopy(roomCopy, videosAllowed) {
  if (!videosAllowed || !roomCopy?.withVideo) return roomCopy
  return { ...roomCopy, ...roomCopy.withVideo }
}
