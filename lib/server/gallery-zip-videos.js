import { buildVideoUrl } from '@/lib/server/mux'

/**
 * Video selection for the synchronous gallery ZIP (/api/download/gallery).
 *
 * Videos are streamed into the archive from Mux's MP4 rendition — the
 * re-encoded, metadata-free file every guest already gets — never from the
 * uploaded original. The ZIP is streamed with backpressure, so memory stays
 * flat, but it still has to finish inside the function's maxDuration: these
 * caps keep a worst-case gallery downloadable on an ordinary connection.
 * Videos past the caps are listed in a note inside the archive instead of
 * being silently dropped.
 */
export const MAX_ZIP_VIDEOS = 100
// Photo.size is the ORIGINAL upload size; Mux's MP4 is usually smaller, so
// this is a conservative upper bound of what actually gets streamed.
export const MAX_ZIP_VIDEO_BYTES = 1.5 * 1024 * 1024 * 1024

/**
 * @param {Array<{id: string, size: number, videoStatus: string|null, muxPlaybackId: string|null}>} videos
 *   newest first
 * @returns {{ included: Array<object & {sourceUrl: string}>, skipped: Array<object>, notReady: Array<object> }}
 */
export function selectZipVideos(videos, { maxCount = MAX_ZIP_VIDEOS, maxBytes = MAX_ZIP_VIDEO_BYTES } = {}) {
  const included = []
  const skipped = []
  const notReady = []
  let bytes = 0
  for (const video of videos || []) {
    if (video.videoStatus !== 'READY' || !video.muxPlaybackId) {
      notReady.push(video)
      continue
    }
    const size = Math.max(0, Number(video.size) || 0)
    if (included.length >= maxCount || bytes + size > maxBytes) {
      skipped.push(video)
      continue
    }
    bytes += size
    included.push({ ...video, sourceUrl: buildVideoUrl(video.muxPlaybackId) })
  }
  return { included, skipped, notReady }
}

/** Plain-text note added to the ZIP when some videos could not be included. */
export function buildZipVideoNote({ skipped, notReady }) {
  if (skipped.length === 0 && notReady.length === 0) return null
  const lines = []
  if (skipped.length > 0) {
    lines.push(
      `${skipped.length} video(s) were not included because this download is limited to ${MAX_ZIP_VIDEOS} videos / ${Math.round(MAX_ZIP_VIDEO_BYTES / 1024 / 1024 / 1024 * 10) / 10} GB.`,
      'You can download them one by one from the gallery:'
    )
    for (const video of skipped) lines.push(`- ${video.originalName || video.id}`)
  }
  if (notReady.length > 0) {
    if (lines.length) lines.push('')
    lines.push(`${notReady.length} video(s) were still processing and are not included yet:`)
    for (const video of notReady) lines.push(`- ${video.originalName || video.id}`)
  }
  return lines.join('\n') + '\n'
}
