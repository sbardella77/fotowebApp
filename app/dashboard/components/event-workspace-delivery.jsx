'use client'

import {
  Archive,
  CheckCircle2,
  Copy,
  Download,
  FolderHeart,
  LinkIcon,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export function EventWorkspaceDelivery({
  event,
  hasPrivateDelivery,
  totalPhotoCount,
  galleryDownloadBusy,
  onGalleryDownload,
  privateAssets,
  privateDeliveryLoading,
  privateDeliveryUploading,
  onPrivateUploadClick,
  onPrivateDownload,
  onPrivateDelete,
  busyDetail,
  photographerLink,
  photographerLinkBusy,
  photographerLinkCopied,
  onGeneratePhotoLink,
  onCopyPhotoLink,
  onRevokePhotoLink,
  t,
}) {
  return (
    <div>
      {/* Download all */}
      <Button
        size="sm"
        variant="outline"
        disabled={galleryDownloadBusy || totalPhotoCount === 0}
        onClick={() => onGalleryDownload(event)}
        className="w-full border-border bg-surface text-foreground hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark"
      >
        {galleryDownloadBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Archive className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />}
        {t.downloadAll || 'Download all'}
      </Button>

      {/* Private Delivery */}
      {hasPrivateDelivery && (
        <div className="mt-5 rounded-xl border border-primary/20 bg-surface shadow-card">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <FolderHeart className="h-4 w-4 text-accent-dark" />
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.privateDelivery}</span>
            </div>
            <h3 className="mt-2 font-display text-base font-bold tracking-tight text-foreground">{t.professionalFiles}</h3>
            <p className="mt-1 text-xs font-light leading-relaxed text-muted-foreground">{t.privateDeliveryDesc}</p>

            <div className="mt-3">
              <Button size="sm" className="cta-primary" disabled={privateDeliveryUploading} onClick={onPrivateUploadClick}>
                {privateDeliveryUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                {privateDeliveryUploading ? t.uploading : t.uploadFile}
              </Button>
            </div>

            <div className="mt-4">
              {privateDeliveryLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.loadingPrivateFiles}
                </div>
              ) : privateAssets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-primary/10 bg-secondary p-6 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-accent-dark">
                    <FolderHeart className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{t.noPrivateFiles}</p>
                  <p className="mt-1 text-xs font-light text-muted-foreground">{t.uploadOriginalDesc}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {privateAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{asset.originalName}</p>
                        <p className="mt-0.5 text-xs font-light text-muted-foreground">{(asset.size / (1024 * 1024)).toFixed(1)} MB · {asset.mimeType?.replace('image/', '').toUpperCase()}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" className="h-8 border-border bg-surface hover:bg-elevated hover:text-foreground" onClick={() => onPrivateDownload(asset)}>
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          {t.download}
                        </Button>
                        <Button size="sm" variant="destructive" className="h-8" disabled={busyDetail} onClick={() => onPrivateDelete(asset.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Photographer Link */}
            <div className="mt-5 rounded-xl border border-border bg-secondary p-4">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent-dark">{t.photographerLink}</span>
              <p className="mt-1 text-xs font-light leading-relaxed text-muted-foreground">{t.photographerLinkDesc}</p>
              <div className="mt-3">
                {!photographerLink && !event?.hasPhotographerUploadLink && (
                  <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                    {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <LinkIcon className="mr-1.5 h-3.5 w-3.5" />}
                    {t.generateLink}
                  </Button>
                )}
                {!photographerLink && event?.hasPhotographerUploadLink && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-muted-foreground">{t.linkAlreadyExists}</p>
                    <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                      {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                      {t.regenerate}
                    </Button>
                    <Button size="sm" variant="destructive" className="h-8" disabled={photographerLinkBusy} onClick={onRevokePhotoLink}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t.revoke}
                    </Button>
                  </div>
                )}
                {photographerLink && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
                      <span className="truncate text-xs text-foreground">{photographerLink}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" onClick={onCopyPhotoLink}>
                        {photographerLinkCopied ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                        {photographerLinkCopied ? t.copied : t.copyLink}
                      </Button>
                      <Button size="sm" variant="outline" className="border-border bg-surface hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent-dark" disabled={photographerLinkBusy} onClick={onGeneratePhotoLink}>
                        {photographerLinkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        {t.regenerate}
                      </Button>
                      <Button size="sm" variant="destructive" className="h-8" disabled={photographerLinkBusy} onClick={onRevokePhotoLink}>
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        {t.revoke}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
