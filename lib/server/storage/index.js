import { localStorageDriver } from './local-storage'
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
