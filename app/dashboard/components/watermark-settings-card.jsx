'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Lock, Stamp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useLocale, useTranslations } from '@/components/i18n-provider'
import { localizedPath } from '@/lib/i18n/config'
import { csrfFetch } from '@/lib/client/csrf-fetch'
import { safeFetchJson } from '@/lib/dashboard-data-helpers'

const API = '/api/owner/account/watermark'
const PREVIEW_DEBOUNCE_MS = 400
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const MAX_TEXT_LENGTH = 40

// 3×3 grid; null cells are not selectable positions.
const POSITION_GRID = [
  'top-left', null, 'top-right',
  null, 'center', null,
  'bottom-left', null, 'bottom-right',
]

const POSITION_LABEL_KEYS = {
  'top-left': 'watermarkPositionTopLeft',
  'top-right': 'watermarkPositionTopRight',
  'bottom-left': 'watermarkPositionBottomLeft',
  'bottom-right': 'watermarkPositionBottomRight',
  center: 'watermarkPositionCenter',
}

const ERROR_KEYS = {
  logo_file_type: 'watermarkErrorFileType',
  logo_too_large: 'watermarkErrorFileTooLarge',
  logo_dimensions: 'watermarkErrorDimensions',
  logo_not_transparent: 'watermarkErrorNotTransparent',
  logo_missing: 'watermarkErrorLogoMissing',
  text_invalid: 'watermarkErrorTextInvalid',
  unsupported_character: 'watermarkErrorUnsupportedChars',
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** The fields the server validates, from the editable config. */
function toPayload(config) {
  return {
    enabled: config.enabled,
    type: config.type,
    text: config.type === 'text' ? config.text : null,
    logoSha256: config.type === 'logo' ? config.logoSha256 : null,
    position: config.position,
    opacityPercent: config.opacityPercent,
    sizePercent: config.sizePercent,
  }
}

/**
 * Photographer watermark settings (Professional/Business). Owners on other
 * plans see a locked card with an upgrade link.
 *
 * @param {{ onSessionFailure: (status: number) => Promise<boolean> }} props
 *   shared owner-session-expiry handling from the account page.
 */
export default function WatermarkSettingsCard({ onSessionFailure }) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const [state, setState] = useState({ loading: true, entitled: false, paused: false, regenState: 'IDLE' })
  const [config, setConfig] = useState(null)
  const [savedPayload, setSavedPayload] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewSample, setPreviewSample] = useState('landscape')
  const [previewError, setPreviewError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const fileInputRef = useRef(null)
  const previewUrlRef = useRef(null)

  // The displayed preview stays until the next one arrives; only then is the
  // previous object URL released.
  const showPreview = useCallback((url) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }, [])

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  }, [])

  const errorMessage = useCallback((code, fallback) => (code && t[ERROR_KEYS[code]]) || fallback, [t])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const response = await fetch(API, { cache: 'no-store' })
        if (await onSessionFailure(response.status)) return
        const { payload } = await safeFetchJson(response, { fallback: {} })
        if (!response.ok) throw new Error(payload.error)
        if (cancelled) return
        setConfig(payload.config)
        setSavedPayload(JSON.stringify(toPayload(payload.config)))
        setState({ loading: false, entitled: !!payload.entitled, paused: !!payload.paused, regenState: payload.regenState || 'IDLE' })
      } catch {
        if (cancelled) return
        setState((prev) => ({ ...prev, loading: false }))
        setMessage({ kind: 'error', text: t.watermarkErrorLoad || 'Unable to load your watermark settings.' })
      }
    }
    run()
    return () => { cancelled = true }
  }, [onSessionFailure, t.watermarkErrorLoad])

  const canPreview = state.entitled && config && (config.type === 'logo' ? !!config.logoSha256 : config.text.trim().length > 0)

  // Server-rendered preview, debounced while the owner edits.
  useEffect(() => {
    if (!canPreview) {
      showPreview(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await csrfFetch(`${API}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...toPayload(config), sample: previewSample }),
          signal: controller.signal,
        })
        if (await onSessionFailure(response.status)) return
        if (!response.ok) {
          const { payload } = await safeFetchJson(response, { fallback: {} })
          setPreviewError(true)
          setMessage({ kind: 'error', text: errorMessage(payload.code, t.watermarkPreviewError || 'The preview could not be loaded.') })
          return
        }
        showPreview(URL.createObjectURL(await response.blob()))
        setPreviewError(false)
      } catch (error) {
        if (error?.name !== 'AbortError') setPreviewError(true)
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [canPreview, config, previewSample, onSessionFailure, errorMessage, showPreview, t.watermarkPreviewError])

  const update = (patch) => {
    setConfig((prev) => ({ ...prev, ...patch }))
    setMessage(null)
  }

  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.type !== 'image/png') {
      setMessage({ kind: 'error', text: t.watermarkErrorFileType || 'The logo must be a PNG image.' })
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setMessage({ kind: 'error', text: t.watermarkErrorFileTooLarge || 'The logo must be 2 MB or smaller.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const response = await csrfFetch(`${API}/logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoDataUrl: await readFileAsDataUrl(file) }),
      })
      if (await onSessionFailure(response.status)) return
      const { payload } = await safeFetchJson(response, { fallback: {} })
      if (!response.ok) {
        setMessage({ kind: 'error', text: errorMessage(payload.code, t.watermarkErrorSave || 'Unable to save your watermark.') })
        return
      }
      update({ type: 'logo', logoSha256: payload.logoSha256, logoUrl: payload.logoUrl })
    } catch {
      setMessage({ kind: 'error', text: t.watermarkErrorSave || 'Unable to save your watermark.' })
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await csrfFetch(API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(config)),
      })
      if (await onSessionFailure(response.status)) return
      const { payload } = await safeFetchJson(response, { fallback: {} })
      if (!response.ok) {
        setMessage({ kind: 'error', text: errorMessage(payload.code, t.watermarkErrorSave || 'Unable to save your watermark.') })
        return
      }
      setConfig(payload.config)
      setSavedPayload(JSON.stringify(toPayload(payload.config)))
      setState((prev) => ({ ...prev, regenState: payload.regenState || 'IDLE' }))
      setMessage({ kind: 'success', text: t.watermarkSaved || 'Saved' })
    } catch {
      setMessage({ kind: 'error', text: t.watermarkErrorSave || 'Unable to save your watermark.' })
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const response = await csrfFetch(API, { method: 'DELETE' })
      if (await onSessionFailure(response.status)) return
      if (!response.ok) throw new Error()
      const reset = { enabled: false, type: 'text', text: '', logoSha256: null, logoUrl: null, position: 'bottom-right', opacityPercent: 60, sizePercent: 20 }
      setConfig(reset)
      setSavedPayload(JSON.stringify(toPayload(reset)))
      setState((prev) => ({ ...prev, paused: false, regenState: 'IDLE' }))
    } catch {
      setMessage({ kind: 'error', text: t.watermarkErrorSave || 'Unable to save your watermark.' })
    } finally {
      setBusy(false)
    }
  }

  if (state.loading) {
    return <div className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
  }

  const header = (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-accent-dark">
        {state.entitled ? <Stamp className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{t.watermarkTitle || 'Your watermark'}</p>
        <p className="mt-1 max-w-sm text-xs font-light text-muted-foreground">
          {t.watermarkDesc || 'Add your logo or studio name to every guest photo in your galleries.'}
        </p>
      </div>
    </div>
  )

  if (!state.entitled) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-subtle">
        {header}
        {state.paused && (
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t.watermarkPaused || 'Your plan is no longer active, so your watermark is paused. Guests see your photos without it.'}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t.watermarkLockedDesc || 'A custom watermark is included with the Professional and Business plans.'}
          </p>
          <Button asChild size="sm">
            <a href={`${localizedPath(locale, '/pricing')}?from=dashboard`}>{t.watermarkUpgradeCta || 'See Professional'}</a>
          </Button>
        </div>
      </div>
    )
  }

  const dirty = JSON.stringify(toPayload(config)) !== savedPayload
  const textLength = [...(config.text || '')].length

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-subtle">
      <div className="flex items-start justify-between gap-4">
        {header}
        <Switch
          checked={config.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => update({ enabled })}
          aria-label={t.watermarkEnableLabel || 'Show the watermark to guests'}
        />
      </div>

      <p className="mt-3 text-xs font-light text-muted-foreground">
        {t.watermarkScopeNote || 'Applied to all photos of all your events, in the gallery and in guest downloads. Your own downloads from the dashboard stay clean. Videos are not watermarked.'}
      </p>

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">{t.watermarkTypeLabel || 'Type'}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={config.type}
              onValueChange={(type) => type && update({ type })}
              className="justify-start"
            >
              <ToggleGroupItem value="text">{t.watermarkTypeText || 'Text'}</ToggleGroupItem>
              <ToggleGroupItem value="logo">{t.watermarkTypeLogo || 'Logo'}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          {config.type === 'text' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="watermark-text" className="text-xs">{t.watermarkTextLabel || 'Text'}</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">{textLength}/{MAX_TEXT_LENGTH}</span>
              </div>
              <Input
                id="watermark-text"
                value={config.text}
                maxLength={MAX_TEXT_LENGTH}
                placeholder={t.watermarkTextPlaceholder || 'e.g. Studio Rossi Photography'}
                onChange={(event) => update({ text: event.target.value })}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <input ref={fileInputRef} type="file" accept="image/png" className="hidden" onChange={handleLogoChange} />
              <div className="flex items-center gap-3">
                {config.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={config.logoUrl} alt="" className="h-10 max-w-[120px] rounded border border-border bg-muted object-contain p-1" />
                )}
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="mr-2 h-4 w-4" />
                  {config.logoSha256 ? (t.watermarkLogoReplace || 'Replace logo') : (t.watermarkLogoUpload || 'Upload logo (PNG)')}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t.watermarkLogoHint || 'Transparent PNG, up to 2 MB, at least 64 px per side.'}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs">{t.watermarkPositionLabel || 'Position'}</Label>
            <div className="grid w-28 grid-cols-3 gap-1" role="radiogroup" aria-label={t.watermarkPositionLabel || 'Position'}>
              {POSITION_GRID.map((position, index) => (position ? (
                <button
                  key={position}
                  type="button"
                  role="radio"
                  aria-checked={config.position === position}
                  aria-label={t[POSITION_LABEL_KEYS[position]] || position}
                  title={t[POSITION_LABEL_KEYS[position]] || position}
                  onClick={() => update({ position })}
                  className={`h-8 rounded border transition-colors ${config.position === position ? 'border-primary bg-primary' : 'border-border bg-muted hover:border-primary/60'}`}
                />
              ) : (
                <span key={`empty-${index}`} className="h-8" aria-hidden="true" />
              )))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t.watermarkOpacityLabel || 'Opacity'}</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">{config.opacityPercent}%</span>
            </div>
            <Slider min={10} max={100} step={5} value={[config.opacityPercent]} onValueChange={([opacityPercent]) => update({ opacityPercent })} aria-label={t.watermarkOpacityLabel || 'Opacity'} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t.watermarkSizeLabel || 'Size'}</Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">{config.sizePercent}%</span>
            </div>
            <Slider min={5} max={50} step={1} value={[config.sizePercent]} onValueChange={([sizePercent]) => update({ sizePercent })} aria-label={t.watermarkSizeLabel || 'Size'} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t.watermarkPreviewTitle || 'Preview'}</Label>
            <ToggleGroup type="single" size="sm" value={previewSample} onValueChange={(sample) => sample && setPreviewSample(sample)}>
              <ToggleGroupItem value="landscape" className="h-7 px-2 text-[11px]">{t.watermarkPreviewLandscape || 'Landscape'}</ToggleGroupItem>
              <ToggleGroupItem value="portrait" className="h-7 px-2 text-[11px]">{t.watermarkPreviewPortrait || 'Portrait'}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
            {previewUrl && !previewError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={t.watermarkPreviewTitle || 'Preview'} className="h-full w-full object-contain" />
            ) : (
              <Stamp className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      {state.regenState === 'PENDING' && config.enabled && !dirty && (
        <p className="mt-4 text-xs text-muted-foreground">
          {t.watermarkApplying || 'Applying the new watermark to your existing photos. Until then they are watermarked on first view.'}
        </p>
      )}

      {message && (
        <p className={`mt-4 text-xs ${message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="ghost" size="sm" disabled={busy} className="text-muted-foreground">
              {t.watermarkRemove || 'Remove watermark'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.watermarkRemoveConfirmTitle || 'Remove your watermark?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.watermarkRemoveConfirmDesc || 'Guests will see your photos without it. You can add it again at any time.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.watermarkCancel || 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemove}>{t.watermarkRemove || 'Remove watermark'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button type="button" size="sm" disabled={busy || !dirty} onClick={handleSave}>
          {t.watermarkSave || 'Save'}
        </Button>
      </div>
    </div>
  )
}
