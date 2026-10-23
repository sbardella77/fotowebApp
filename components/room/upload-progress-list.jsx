'use client'

import { CheckCircle2, Clock3, FileWarning, RefreshCcw } from 'lucide-react'

export const UPLOAD_STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  DONE: 'done',
  ERROR: 'error',
}

export function getUploadStatusLabel(upload, t, tCommon) {
  switch (upload.status) {
    case UPLOAD_STATUS.QUEUED:
      return upload.detail || t.preparingUpload
    case UPLOAD_STATUS.UPLOADING:
      return upload.detail || t.uploadingPhotos
    case UPLOAD_STATUS.DONE:
      return tCommon.done
    case UPLOAD_STATUS.ERROR:
      return upload.errorMessage || t.uploadFailedTryAgain
    default:
      return ''
  }
}

export function UploadProgressList({ uploads, onRetry, canRetry, t, tCommon }) {
  if (uploads.length === 0) return null
  return (
    <div className="mt-4 space-y-3" role="region" aria-label={t.uploadingPhotos} aria-live="polite">
      {uploads.map((upload) => {
        const showRetry = upload.status === UPLOAD_STATUS.ERROR && typeof onRetry === 'function' && canRetry?.(upload.id)
        return (
        <div key={upload.id} className="rounded-xl border border-border bg-surface p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{upload.name}</p>
              <p className="text-xs font-light text-muted-foreground">{getUploadStatusLabel(upload, t, tCommon)}</p>
            </div>
            {showRetry && (
              <button
                type="button"
                onClick={() => onRetry(upload.id)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-elevated"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {tCommon.retry}
              </button>
            )}
            {upload.status === UPLOAD_STATUS.DONE && <CheckCircle2 className="h-4 w-4 text-success shrink-0" />}
            {upload.status === UPLOAD_STATUS.ERROR && !showRetry && <FileWarning className="h-4 w-4 text-destructive shrink-0" />}
            {upload.status !== UPLOAD_STATUS.DONE && upload.status !== UPLOAD_STATUS.ERROR && <Clock3 className="h-4 w-4 text-muted-foreground shrink-0" />}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                upload.status === UPLOAD_STATUS.DONE ? 'bg-success' : upload.status === UPLOAD_STATUS.ERROR ? 'bg-destructive' : 'bg-primary'
              }`}
              style={{ width: `${upload.progress}%` }}
            />
          </div>
        </div>
        )
      })}
    </div>
  )
}
