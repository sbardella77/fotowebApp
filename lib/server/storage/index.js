import { localStorageDriver } from './local-storage'
import { deleteAsset } from '@/lib/server/mux'
import {
  buildBlobPathname,
  buildPrivateDeliveryBlobPathname,
  getStoredNameFromBlobPathname,
  isVercelBlobStorageConfigured,
  vercelBlobStorageDriver,
} from './vercel-blob-storage'

export const getStorageDriver = () => {
  return isVercelBlobStorageConfigured() ? vercelBlobStorageDriver : localStorageDriver
}

export const getStorageMode = () => {
  return getStorageDriver().mode
}

export const deleteStoredFile = async (url) => {
  if (!url) {
    return
  }

  if (url.startsWith('mux://')) {
    // mux://events/<slug>/<assetId>; callers validate the reference first
    // (deleteEventScopedStoredFile). Upload placeholders have no asset yet.
    const assetId = url.split('/').pop()
    if (!assetId || assetId.startsWith('upload-')) return
    return deleteAsset(assetId)
  }

  if (url.startsWith('http')) {
    return vercelBlobStorageDriver.deleteStoredFile(url)
  }

  return localStorageDriver.deleteStoredFile(url)
}

export {
  buildBlobPathname,
  buildPrivateDeliveryBlobPathname,
  getStoredNameFromBlobPathname,
  isVercelBlobStorageConfigured,
  localStorageDriver,
  vercelBlobStorageDriver,
}
