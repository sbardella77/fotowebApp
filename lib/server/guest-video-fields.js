import { buildHlsUrl, buildPosterUrl, buildVideoUrl } from '@/lib/server/mux'

/**
 * Guest DTO fields for a VIDEO Photo row. Same fail-closed shape as
 * resolveGuestPhotoUrl: URLs exist only once Mux has produced the
 * re-encoded (metadata-free) rendition; any other state yields nulls and
 * the gallery shows a "processing" tile. Never exposes Mux asset/upload ids.
 */
export function toGuestVideoFields({ videoStatus, muxPlaybackId, durationSec }) {
  const ready = videoStatus === 'READY' && Boolean(muxPlaybackId)
  // A playback id is only stored once the Mux asset is `ready` (encoded,
  // metadata stripped): poster + HLS are servable from then on, while the
  // MP4 (download/share/non-HLS browsers) waits for READY.
  const playable = Boolean(muxPlaybackId) && videoStatus !== 'FAILED'
  return {
    mediaType: 'VIDEO',
    videoStatus: videoStatus || 'PROCESSING',
    url: playable ? buildPosterUrl(muxPlaybackId) : null,
    videoUrl: ready ? buildVideoUrl(muxPlaybackId) : null,
    hlsUrl: playable ? buildHlsUrl(muxPlaybackId) : null,
    durationSec: typeof durationSec === 'number' ? Math.round(durationSec) : null,
  }
}
