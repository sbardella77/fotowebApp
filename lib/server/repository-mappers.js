export const toIsoString = (value) => {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  return new Date(value).toISOString()
}

export const normalizePhotoRecord = (photo) => ({
  ...photo,
  createdAt: toIsoString(photo.createdAt),
  updatedAt: toIsoString(photo.updatedAt),
})

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
