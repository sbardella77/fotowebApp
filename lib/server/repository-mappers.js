import { resolveGuestPhotoUrl } from '@/lib/server/guest-photo-url'

export const toIsoString = (value) => {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  return new Date(value).toISOString()
}

/**
 * @param {object} photo raw Prisma Photo row (must still carry
 *   displayDerivativeStatus when guestSafe is true — call this BEFORE any
 *   other step strips that field).
 * @param {{guestSafe?: boolean}} [options] guestSafe (default true — fail
 *   closed) replaces `url` with resolveGuestPhotoUrl(...): the guest-safe
 *   derivative URL, or null for anything not READY. Pass `guestSafe: false`
 *   ONLY for an already-authenticated, non-guest data path that has a
 *   genuine need for the original asset (owner's own dashboard, admin
 *   moderation) — never based on a client-supplied flag.
 */
export const normalizePhotoRecord = (photo, { guestSafe = true } = {}) => {
  // uploadActorType is server-side analytics attribution metadata, never
  // meant for the public Photo API surface (Guest Room, gallery listings).
  // Admin/analytics aggregation queries Postgres directly instead.
  //
  // displayDerivativeStatus (see DisplayDerivativeStatus in
  // prisma/schema.prisma) is internal EXIF-safe-delivery bookkeeping —
  // never meant for any Photo API response, guest or owner/admin alike.
  // It is consumed right here (guestSafe path) to compute the safe `url`
  // and then discarded either way. Server-side code that needs the raw
  // status for its own purposes (ensurePhotoDisplayDerivative) reads the
  // Prisma row directly, before normalization.
  const { uploadActorType, displayDerivativeStatus, url, ...publicPhoto } = photo

  return {
    ...publicPhoto,
    url: guestSafe ? resolveGuestPhotoUrl({ id: photo.id, displayDerivativeStatus }) : url,
    createdAt: toIsoString(photo.createdAt),
    updatedAt: toIsoString(photo.updatedAt),
  }
}

export const normalizePrivateAssetRecord = (asset) => ({
  ...asset,
  createdAt: toIsoString(asset.createdAt),
  updatedAt: toIsoString(asset.updatedAt),
})

export const normalizeEventMomentRecord = (moment) => ({
  ...moment,
  createdAt: toIsoString(moment.createdAt),
  updatedAt: toIsoString(moment.updatedAt),
})

/**
 * @param {{guestSafe?: boolean}} options guestSafe (default true) is
 *   threaded to normalizePhotoRecord for every photo in `photos`. It does
 *   NOT affect `latestPhotoUrl` — callers compute that separately (from a
 *   raw, unnormalized photo) and must apply the same guest-safety
 *   decision themselves; see prisma-gallery-repository.js.
 */
export const normalizeEventRecord = ({ event, photos = [], photoCount = 0, latestPhotoUrl = null, privateAssets = [], moments = [], guestSafe = true }) => ({
  ...event,
  createdAt: toIsoString(event.createdAt),
  updatedAt: toIsoString(event.updatedAt),
  photoCount,
  latestPhotoUrl,
  photos: photos.map((photo) => normalizePhotoRecord(photo, { guestSafe })),
  privateAssets: privateAssets.map(normalizePrivateAssetRecord),
  moments: moments.map(normalizeEventMomentRecord),
})
