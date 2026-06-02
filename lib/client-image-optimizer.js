/**
 * Client-side image optimization before upload.
 * Rules:
 * - Skip GIFs and non-images
 * - Resize if longest side > 2400px
 * - JPEG quality: 0.82, WebP quality: 0.85
 * - Preserve EXIF orientation via createImageBitmap
 * - Fallback to original file on any failure
 */

const MAX_DIMENSION = 2400

export async function optimizeImage(file) {
  if (!file.type?.startsWith('image/')) return file
  if (file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    let { width, height } = bitmap
    const maxSide = Math.max(width, height)

    if (maxSide <= MAX_DIMENSION) {
      bitmap.close()
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `[optimize] ${file.name}: ${(file.size / 1024).toFixed(1)}KB — no resize needed`
        )
      }
      return file
    }

    const scale = MAX_DIMENSION / maxSide
    width = Math.round(width * scale)
    height = Math.round(height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const outputType = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const quality = file.type === 'image/webp' ? 0.85 : 0.82

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, outputType, quality)
    })

    if (!blob) {
      console.warn(`[optimize] ${file.name}: toBlob failed, using original`)
      return file
    }

    const optimizedFile = new File([blob], file.name, {
      type: outputType,
      lastModified: file.lastModified,
    })

    if (process.env.NODE_ENV === 'development') {
      const ratio = ((1 - blob.size / file.size) * 100).toFixed(1)
      console.log(
        `[optimize] ${file.name}: ${(file.size / 1024).toFixed(1)}KB → ${(
          blob.size / 1024
        ).toFixed(1)}KB (${ratio}% smaller)`
      )
    }

    return optimizedFile
  } catch (error) {
    console.warn(
      `[optimize] ${file.name}: optimization failed, using original`,
      error
    )
    return file
  }
}
