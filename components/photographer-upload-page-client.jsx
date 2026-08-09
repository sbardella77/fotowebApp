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
import { useTranslations } from '@/components/i18n-provider'

export default function PhotographerUploadPageClient({ token }) {
  const [loading, setLoading] = useState(true)
  const [event, setEvent] = useState(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [assets, setAssets] = useState([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef(null)
  const t = useTranslations('photographerUpload')
  const tCommon = useTranslations('common')

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
        throw new Error(payload.error || t.invalidLink)
      }
      setEvent(payload.event)
      await loadAssets()
    } catch (err) {
      setError(err.message || t.invalidLink)
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
        throw new Error(initPayload.error || t.unableToInitialize)
      }

      if (initPayload.session?.uploadStrategy === 'vercel-blob-client') {
        const session = initPayload.session
        await upload(session.pathname, file, {
          access: 'public',
          handleUploadUrl: session.handleUploadUrl,
          clientPayload: JSON.stringify({
            sessionId: session.sessionId,
          }),
          multipart: file.size > 5 * 1024 * 1024,
        })

        const completeResponse = await fetch(`/api/photographer-upload/${token}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.sessionId,
          }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || t.unableToFinalize)
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
            throw new Error(t.chunkFailed)
          }
        }

        const completeResponse = await fetch(`/api/photographer-upload/${token}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: initPayload.session.sessionId }),
        })
        const completePayload = await completeResponse.json()

        if (!completeResponse.ok) {
          throw new Error(completePayload.error || t.unableToFinalize)
        }

        trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_COMPLETED, { room_slug: event.slug, asset_id: completePayload.asset?.id, file_size: file.size })
        setUploadSuccess(true)
        await loadAssets()
      }
    } catch (err) {
      trackEvent(EVENT_PHOTOGRAPHER_UPLOAD_FAILED, { room_slug: event?.slug, error: err.message })
      setError(err.message || t.uploadFailed)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  if (loading) {
    return (
      <main className="relative min-h-screen bg-background font-body text-foreground">
        <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.loading}
          </div>
        </div>
      </main>
    )
  }

  if (error && !event) {
    return (
      <main className="relative min-h-screen bg-background font-body text-foreground">
        <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-card">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Camera className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-foreground">{t.linkUnavailable}</h1>
            <p className="mt-2 text-sm font-light text-muted-foreground">{error}</p>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="relative min-h-screen bg-background font-body text-foreground">
      <div className="absolute inset-0 bg-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />

      <header className="sticky top-0 z-30 h-14 border-b border-border bg-background/80 backdrop-blur-md">
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
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="p-5 sm:p-6">
              <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                {t.privateUpload}
              </span>
              <h1 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {event?.name}
              </h1>
              <p className="mt-2 text-sm font-light text-muted-foreground">
                {t.uploadDesc}
              </p>
            </div>
          </div>

          {/* Upload card */}
          <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
            <div className="p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FolderHeart className="h-6 w-6" />
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">{t.uploadProfessionalFiles}</h2>
              <p className="mt-2 text-sm font-light text-muted-foreground">
                {t.fileTypes}
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
                  className="h-12 gap-2 rounded-lg px-6 text-base font-body font-medium cta-primary"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? t.uploading : t.selectFile}
                </Button>
              </div>

              {uploadSuccess && (
                <div className="mt-4 rounded-full border border-success/20 bg-success/10 px-5 py-3 text-sm font-medium text-success">
                  <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                  {t.uploadSuccess}
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-5 py-3 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Uploaded files list */}
          <div className="rounded-2xl border border-border bg-surface shadow-card">
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.1em] text-primary">
                  {t.yourUploads}
                </span>
              </div>

              <div className="mt-4">
                {assetsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.loading}
                  </div>
                ) : assets.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-raised p-8 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <ImagePlus className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-light text-muted-foreground">{t.noUploadsYet}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-border bg-raised p-4"
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
