'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { ImagePlus, Loader2, Save, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { csrfFetch } from '@/lib/client/csrf-fetch'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (err) => reject(err))
    image.src = url
  })
}

async function getCroppedImg(imageSrc, pixelCrop) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )
  return canvas.toDataURL('image/jpeg', 0.92)
}

export function EventCoverEditor({ event, onCoverUpdated, onOwnerSessionFailure, t, tCommon }) {
  const [open, setOpen] = useState(false)
  const [imageSrc, setImageSrc] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileInputRef = useRef(null)

  const reset = () => {
    setImageSrc(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setError(null)
    setPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onCropComplete = useCallback((_, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels)
  }, [])

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t.invalidFormat)
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(t.fileTooBig)
      return
    }

    setError(null)
    const dataUrl = await readFile(file)
    setImageSrc(dataUrl)
  }

  const generatePreview = async () => {
    if (!imageSrc || !croppedAreaPixels) return
    const cropped = await getCroppedImg(imageSrc, croppedAreaPixels)
    setPreviewUrl(cropped)
  }

  useEffect(() => {
    if (imageSrc && croppedAreaPixels) {
      const timer = setTimeout(() => generatePreview(), 200)
      return () => clearTimeout(timer)
    }
  }, [imageSrc, croppedAreaPixels, crop, zoom])

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return

    if (event.coverUrl) {
      setConfirmReplaceOpen(true)
      return
    }

    await saveCover()
  }

  const saveCover = async () => {
    setBusy(true)
    setError(null)
    try {
      const croppedDataUrl = await getCroppedImg(imageSrc, croppedAreaPixels)
      const response = await csrfFetch(`/api/owner/events/${event.slug}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverDataUrl: croppedDataUrl }),
      })
      if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to save cover')
      }
      onCoverUpdated(payload.event)
      setOpen(false)
      reset()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
      setConfirmReplaceOpen(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      <Button
        size="sm"
        variant="outline"
        className="border-border bg-surface text-foreground hover:bg-elevated focus-visible:ring-2 focus-visible:ring-accent-dark"
        onClick={() => {
          reset()
          setOpen(true)
          setTimeout(() => fileInputRef.current?.click(), 100)
        }}
      >
        <ImagePlus className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
        {event.coverUrl ? t.updateCoverImage : t.addCoverImage}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v) }}>
        <DialogContent className="max-w-3xl rounded-xl border-border bg-surface p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="font-display text-lg font-bold text-foreground">
              {event.coverUrl ? t.updateCoverImage : t.addCoverImage}
            </DialogTitle>
            <DialogDescription className="text-sm font-light text-muted-foreground">
              {t.coverEditorDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-2">
            {!imageSrc ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-raised p-10 transition-colors hover:border-[hsl(var(--border-visible))] hover:bg-elevated"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{t.selectImage}</p>
                <p className="text-xs font-light text-muted-foreground">{t.maxFileSize}</p>
              </button>
            ) : (
              <div className="space-y-4">
                <div className="relative h-64 w-full overflow-hidden rounded-xl bg-raised">
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={16 / 9}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={onCropComplete}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{t.zoom}</span>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="flex-1 accent-accent-dark"
                  />
                </div>

                {previewUrl && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t.desktopPreview}</p>
                      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-subtle">
                        <div className="relative h-28 w-full">
                          <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
                        </div>
                        <div className="p-2.5">
                          <p className="truncate text-xs font-semibold text-foreground">{event.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{event.slug}</p>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t.mobilePreview}</p>
                      <div className="mx-auto w-32 overflow-hidden rounded-xl border border-border bg-surface shadow-subtle">
                        <div className="relative h-20 w-full">
                          <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
                        </div>
                        <div className="p-2">
                          <p className="truncate text-[10px] font-semibold text-foreground">{event.name}</p>
                          <p className="truncate text-[9px] text-muted-foreground">{event.slug}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="px-6 pb-6 pt-2">
            <Button variant="ghost" onClick={() => { setOpen(false); reset() }} className="text-muted-foreground hover:text-foreground">
              {tCommon.cancel}
            </Button>
            <Button
              className="cta-primary"
              disabled={!imageSrc || !croppedAreaPixels || busy}
              onClick={handleSave}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {t.saveCover}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent className="rounded-xl border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-bold text-foreground">{t.replaceCoverConfirm}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-light text-muted-foreground">
              {t.replaceCoverDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmReplaceOpen(false)} className="border-border bg-raised text-foreground hover:bg-elevated">
              {tCommon.cancel}
            </AlertDialogCancel>
            <AlertDialogAction onClick={saveCover} className="cta-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.replaceCover}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function EventCoverRemove({ event, onCoverUpdated, onOwnerSessionFailure, t, tCommon }) {
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleRemove = async () => {
    if (!event?.slug) return
    setBusy(true)
    try {
      const response = await csrfFetch(`/api/owner/events/${event.slug}/cover`, {
        method: 'DELETE',
      })
      if (onOwnerSessionFailure && (await onOwnerSessionFailure(response.status))) return
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to remove cover')
      }
      onCoverUpdated(payload.event)
    } catch (err) {
      console.error('[removeCover] error:', err)
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  if (!event?.coverUrl) return null

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-border bg-surface text-destructive hover:bg-destructive/5 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        {t.removeCoverImage}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-xl border-border bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-bold text-foreground">{t.removeCoverConfirm}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-light text-muted-foreground">
              {t.removeCoverDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmOpen(false)} className="border-border bg-raised text-foreground hover:bg-elevated">
              {tCommon.cancel}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.removeCoverImage}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
