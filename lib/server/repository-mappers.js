export const toIsoString = (value) => {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  return new Date(value).toISOString()
}

export const normalizePhotoRecord = (photo) => {
  // uploadActorType is server-side analytics attribution metadata, never
  // meant for the public Photo API surface (Guest Room, gallery listings).
  // Admin/analytics aggregation queries Postgres directly instead.
  const { uploadActorType, ...publicPhoto } = photo

  return {
    ...publicPhoto,
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

export const normalizeEventRecord = ({ event, photos = [], photoCount = 0, latestPhotoUrl = null, privateAssets = [], moments = [] }) => ({
  ...event,
  createdAt: toIsoString(event.createdAt),
  updatedAt: toIsoString(event.updatedAt),
  photoCount,
  latestPhotoUrl,
  photos: photos.map(normalizePhotoRecord),
  privateAssets: privateAssets.map(normalizePrivateAssetRecord),
  moments: moments.map(normalizeEventMomentRecord),
})
