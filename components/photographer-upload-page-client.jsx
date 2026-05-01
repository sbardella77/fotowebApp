'use client'

import { useEffect, useRef, useState } from 'react'
import { upload } from '@vercel/blob/client'
import { Camera, CheckCircle2, FolderHeart, ImagePlus, Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/track-client'
import {
  EVENT_PHOTOGRAPHER_UPLOAD_STARTED,
  EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED,
  EVENT_PHOTOGRAPHER_UPLOAD_FAILED,
} from '@/lib/analytics/events'

export default function PhotographerUploadPageClient({ token }) {
  const [loading, setLoading] = useState(true)
  const [event, setEvent] = useState(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [assets, setAssets] = useState([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    validateToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const validateToken = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/photographer-upload/${token}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Invalid or expired link')
      }
      setEvent(payload.event)
      await loadAssets()
    } catch (err) {
      setError(err.message || 'This link is invalid or has expired.')
    } finally {
      setLoading(false)
    }
  }

  const loadAssets = async () => {
    setAssetsLoading(true)
    try {
      const response = await fetch(`/api/photographer-upload/${token}/assets`, { cache: 'no-store' })
      const payload = await response.json()
      if (response.ok) {
        setAssets(payload.assets || [])
      }
    } catch {
      // ignore
    } finally {
      setAssetsLoading(false)
    }
  }

  const onFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    uploadFile(file)
  }

  const uploadFile = async (file) => {
    if (!event?.slug || !file) return

    setUploading(true)
    setError('')
    setUploadSuccess(false)

    try {
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_STARTED, { room_slug: event.slug, file_name: file.name, file_size: file.size })

      const CHUNK_SIZE = 1024 * 1024
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

      const initResponse = await fetch(`/api/photographer-upload/${token}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug: event.slug,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'image/jpeg',
          totalChunks,
        }),
      })
      const initPayload = await initResponse.json()

      if (!initResponse.ok) {
        throw new Error(initPayload.error || 'Unable to initialize upload')
      }

      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        const blob = await upload(initPayload.session.pathname || file.name, file, {
          access: 'public',
          handleUploadUrl: initPayload.session.handleUploadUrl || `/api/photographer-upload/${token}/blob`,
          clientPayload: JSON.stringify({
            eventSlug: event.slug,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'image/jpeg',
          }),
          multipart: file.size > 5 * 1024 * 1024,
        })

        const completeResponse = await fetch(`/api/photographer-upload/${token}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventSlug: event.slug,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            originalName: file.name,
            mimeType: file.type || 'image/jpeg',
            size: file.size,
          }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || 'Unable to finalize upload')
        }

        trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED, { room_slug: event.slug, asset_id: completePayload.asset?.id, file_size: file.size })
        setUploadSuccess(true)
        await loadAssets()
      } else {
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const start = chunkIndex * CHUNK_SIZE
          const end = Math.min(start + CHUNK_SIZE, file.size)
          const chunkBlob = file.slice(start, end)

          const formData = new FormData()
          formData.append('sessionId', initPayload.session.sessionId)
          formData.append('chunkIndex', String(chunkIndex))
          formData.append('totalChunks', String(totalChunks))
          formData.append('chunk', chunkBlob, `${file.name}.part-${chunkIndex}`)

          const chunkResponse = await fetch('/api/uploads/chunk', {
            method: 'POST',
            body: formData,
          })

          if (!chunkResponse.ok) {
            throw new Error('Chunk upload failed')
          }
        }

        const completeResponse = await fetch(`/api/photographer-upload/${token}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: initPayload.session.sessionId }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || 'Unable to finalize upload')
        }

        trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED, { room_slug: event.slug, asset_id: completePayload.asset?.id, file_size: file.size })
        setUploadSuccess(true)
        await loadAssets()
      }
    } catch (err) {
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_FAILED, { room_slug: event?.slug, error: err.message })
      setError(err.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (loading) {
    return (
      <main className="dark relative min-h-screen bg-background font-body text-foreground">
        <div className="absolute inset-0 bg-grid opacity-[0.03]" />
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
      </main>
    )
  }

  if (error && !event) {
    return (
      <main className="dark relative min-h-screen bg-background font-body text-foreground">
        <div className="absolute inset-0 bg-grid opacity-[0.03]" />
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.07] bg-[#141C2E] p-8 text-center shadow-card">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
              <Camera className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-white">Link unavailable</h1>
            <p className="mt-2 text-sm font-light text-muted-foreground">{error}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="dark relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.03]" />

      <header className="sticky top-0 z-30 h-14 border-b border-white/[0.07] bg-[#13131f]/80 backdrop-blur-md">
        <div className="container flex h-full items-center justify-between px-4">
          <a href="/" className="flex items-center gap-2 text-foreground">
            <Camera className="h-5 w-5 text-primary" />
            <span className="font-display text-base font-semibold tracking-tight">SnapRooms</span>
          </a>
        </div>
      </header>

      <section className="container mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <div className="space-y-6">
          {/* Room info */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
            <div className="p-5 sm:p-6">
              <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                Private upload
              </span>
              <h1 className="mt-1 font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
                {event?.name}
              </h1>
              <p className="mt-2 text-sm font-light text-muted-foreground">
                Upload original-quality files privately. Only visible to the room owner. Separate from guest photos.
              </p>
            </div>
          </div>

          {/* Upload card */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card overflow-hidden">
            <div className="p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FolderHeart className="h-6 w-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-white">Upload professional files</h2>
              <p className="mt-2 text-sm font-light text-muted-foreground">
                JPEG or PNG up to 100 MB. Files are stored privately and never shown in the public gallery.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={onFileSelect}
              />

              <div className="mt-6">
                <Button
                  size="lg"
                  className="h-12 gap-2 rounded-lg px-6 text-base font-body font-medium glow-blue"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? 'Uploading...' : 'Select file'}
                </Button>
              </div>

              {uploadSuccess && (
                <div className="mt-4 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-400">
                  <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                  File uploaded successfully
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-5 py-3 text-sm font-medium text-red-400">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Uploaded files list */}
          <div className="rounded-2xl border border-white/[0.07] bg-[#141C2E] shadow-card">
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  Your uploads
                </span>
              </div>

              <div className="mt-4">
                {assetsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : assets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/[0.07] bg-[#0D1220] p-8 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-light text-muted-foreground">No uploads yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-[#0D1220] p-4"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {asset.originalName}
                          </p>
                          <p className="mt-0.5 text-xs font-light text-muted-foreground">
                            {(asset.size / (1024 * 1024)).toFixed(1)} MB · {asset.mimeType?.replace('image/', '').toUpperCase()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
