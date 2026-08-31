'use client'

import { useRef, useMemo, useState, useCallback, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  X,
  Copy,
  Download,
  Printer,
  Share2,
  CheckCircle2,
  Link2,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/components/i18n-provider'
import { getQRCopy } from '@/lib/qr-copy'

// Simple toast hook for internal use
const useToast = () => {
  const [toast, setToast] = useState(null)
  
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 2000)
  }, [])
  
  const ToastComponent = useCallback(() => {
    if (!toast) return null
    return (
      <div className={`fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
        toast.type === 'success' ? 'bg-foreground text-background' : 'bg-destructive text-destructive-foreground'
      }`}>
        {toast.message}
      </div>
    )
  }, [toast])
  
  return { showToast, ToastComponent }
}

// The canonical QR badge overlay, used both on-screen and in the downloaded
// PNG. On screen it's rendered at h-10 w-10 (40px) with p-1 (4px) padding
// against a 200px QR — a 20% white backing box, 16% visible badge. This
// constant preserves that exact ratio at any output resolution.
const QR_BADGE_SRC = '/brand/snaprooms-qr-badge.svg'
const QR_BADGE_BOX_RATIO = 0.2
const QR_BADGE_CONTENT_RATIO = 0.16

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (err) => reject(err)
    img.src = src
  })
}

// Generate a clean filename from event name
function generateFilename(eventName) {
  const clean = eventName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 40)
  return `snaprooms-${clean || 'event'}-qr.png`
}



export function EventQRModal({ 
  isOpen, 
  onClose, 
  event,
  baseUrl = typeof window !== 'undefined' ? window.location.origin : '',
  className = ''
}) {
  const t = useTranslations('room')
  const tCommon = useTranslations('common')
  const { showToast, ToastComponent } = useToast()
  const qrContainerRef = useRef(null)
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  
  const eventUrl = useMemo(() => {
    if (!event?.slug) return ''
    return `${baseUrl}/event/${event.slug}`
  }, [event?.slug, baseUrl])

  const filename = useMemo(() => {
    if (!event?.name) return 'snaprooms-event-qr.png'
    return generateFilename(event.name)
  }, [event?.name])

  const eventType = event?.eventType || 'generic'
  const headline = t[`qrHeadline${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`] || t.qrHeadlineGeneric
  const instruction = t[`qrInstruction${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`] || t.qrInstructionGeneric
  const trustLine = t.qrTrustLine

  // Download QR code as PNG — composited with the canonical badge overlay so
  // the downloaded file matches what's shown on screen. The badge is never
  // redrawn: it's the same /brand/snaprooms-qr-badge.svg asset used
  // everywhere else, loaded and drawn onto the canvas as its own image.
  const handleDownload = useCallback(async () => {
    if (!qrContainerRef.current) return

    const svg = qrContainerRef.current.querySelector('svg')
    if (!svg) {
      showToast(t.qrCodeNotFound, 'error')
      return
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      showToast(t.failedToCreateImage, 'error')
      return
    }

    // Larger canvas for better print/download quality.
    const size = 800
    canvas.width = size
    canvas.height = size

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const qrUrl = URL.createObjectURL(svgBlob)

    try {
      const [qrImage, badgeImage] = await Promise.all([
        loadImage(qrUrl),
        loadImage(QR_BADGE_SRC),
      ])

      // Fill white background, then the QR pattern.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(qrImage, 0, 0, size, size)

      // Badge overlay: a white backing square (quiet zone against the QR
      // modules) then the badge centered inside it, at the exact same
      // box/content ratio as the on-screen overlay (20% / 16% of QR width).
      const boxSize = size * QR_BADGE_BOX_RATIO
      const contentSize = size * QR_BADGE_CONTENT_RATIO
      const boxOffset = (size - boxSize) / 2
      const contentOffset = (size - contentSize) / 2
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(boxOffset, boxOffset, boxSize, boxSize)
      ctx.drawImage(badgeImage, contentOffset, contentOffset, contentSize, contentSize)

      if (typeof canvas.toBlob !== 'function') {
        showToast(t.downloadNotSupported, 'error')
        return
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          showToast(t.failedToGenerateImage, 'error')
          return
        }
        try {
          const downloadUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = downloadUrl
          link.download = filename
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(downloadUrl)
          showToast(t.qrCodeDownloaded)
        } catch (e) {
          console.warn('[qr-modal] download failed', e)
          showToast(t.downloadFailed, 'error')
        }
      }, 'image/png')
    } catch (error) {
      console.error('Download error:', error)
      showToast(t.failedToGenerateImage, 'error')
    } finally {
      URL.revokeObjectURL(qrUrl)
    }
  }, [filename, showToast])

  // Copy event link
  const handleCopyLink = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
      showToast(t.copyNotSupported, 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(eventUrl)
      setCopiedLink(true)
      showToast(t.linkCopied)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      showToast(t.failedToCopy, 'error')
    }
  }, [eventUrl, showToast])

  // Copy event code
  const handleCopyCode = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
      showToast(t.copyNotSupported, 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(event?.slug || '')
      setCopiedCode(true)
      showToast(t.codeCopied)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      showToast(t.failedToCopy, 'error')
    }
  }, [event?.slug, showToast])

  // Share (native or fallback)
  const handleShare = useCallback(async () => {
    const shareData = {
      title: t.joinRoomOnSnapRooms.replace('{name}', event?.name || ''),
      text: `${t.uploadYourPhotosTo.replace('{name}', event?.name || '')} ${t.useCode || 'Use code:'} ${event?.slug}`,
      url: eventUrl,
    }
    
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData)
        showToast(t.shared)
      } catch {
        // User cancelled
      }
    } else {
      handleCopyLink()
    }
  }, [event?.name, event?.slug, eventUrl, handleCopyLink, showToast])

  // Print QR card
  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  // Focus management: move focus into the dialog on open, trap Tab/Shift+Tab
  // within it (matching the ARIA APG dialog pattern), close on Escape, and
  // restore focus to whatever triggered the modal when it closes — by any
  // means (Escape, backdrop click, or the X button), since this is a
  // cleanup function rather than the Escape handler alone.
  // Deliberately keyed on [isOpen] only (onClose is read via a ref) so a
  // parent re-render while the modal is open — room-page-client.jsx passes
  // a fresh onClose closure every render — can't re-fire this effect and
  // steal focus back to the first element mid-interaction.
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return

    const previouslyFocused = document.activeElement
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const dialog = dialogRef.current
    dialog?.querySelector(focusableSelector)?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && dialog) {
        const focusable = Array.from(dialog.querySelectorAll(focusableSelector))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [isOpen])

  if (!isOpen || !event) return null

  return (
    <>
      {/* Main Modal Overlay */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm print:hidden"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={headline}
          className={`relative my-auto w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl max-h-[90vh] overflow-y-auto overscroll-contain ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header with gradient */}
          <div className="relative bg-gradient-to-br from-primary/5 via-background to-background px-6 pb-4 pt-6">
            {/* Close button */}
            <button
              className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              onClick={onClose}
              aria-label={tCommon.close}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header Content */}
            <div className="text-center">
              <img
                src="/brand/snaprooms-qr-badge.svg"
                alt="SnapRooms"
                className="mx-auto mb-3 h-12 w-12"
              />
              <h2 className="text-xl font-semibold tracking-tight">{t.shareThisRoom}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.guestsScanQR}
              </p>
            </div>
          </div>

          {/* Modal Body */}
          <div className="px-6 pb-6">
            {/* Event Name Card */}
            <div className="mb-4 rounded-xl border border-border/50 bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.roomLabel}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{event.name}</p>
            </div>

            {/* Logo */}
            <img
              src="/brand/snaprooms-qr-badge.svg"
              alt="SnapRooms"
              className="mx-auto mb-3 h-10 w-10"
            />

            {/* QR Code Card */}
            <div className="relative mb-4 rounded-xl border-2 border-primary/20 bg-white p-6">
              {/* Headline */}
              <div className="mb-4 text-center">
                <p className="text-lg font-bold text-gray-900">{headline}</p>
              </div>

              {/* QR Code */}
              <div className="mb-4 flex justify-center" ref={qrContainerRef}>
                <div className="relative inline-block">
                  <QRCodeSVG
                    value={eventUrl}
                    size={200}
                    level="H"
                    includeMargin={true}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                  <img
                    src="/brand/snaprooms-qr-badge.svg"
                    alt="SnapRooms"
                    className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-1"
                  />
                </div>
              </div>

              {/* Instruction */}
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-900">{instruction}</p>
                <p className="mt-2 text-xs text-gray-500">{trustLine}</p>
              </div>
            </div>

            {/* Event Code Badge */}
            <div className="mb-5 flex items-center justify-center gap-2">
              <button
                onClick={handleCopyCode}
                className="group flex items-center gap-2 rounded-full border border-border/50 bg-muted/30 px-4 py-2 text-sm font-medium transition-all hover:bg-muted"
              >
                <span className="text-muted-foreground">{t.roomCode}</span>
                <span className="font-mono text-foreground">{event.slug}</span>
                {copiedCode ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button
                variant="outline"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handleCopyLink}
              >
                {copiedLink ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                <span className="text-xs">{t.copyLink}</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                <span className="text-xs">{t.downloadQR}</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handlePrint}
              >
                <Printer className="h-4 w-4" />
                <span className="text-xs">{t.quickPrint}</span>
              </Button>
              
              <Button
                variant="secondary"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handleShare}
              >
                <Share2 className="h-4 w-4" />
                <span className="text-xs">{tCommon.share}</span>
              </Button>
            </div>
            
            {/* Advanced print link */}
            <div className="mt-3 text-center">
              <a
                href={`/event/${event.slug}/print`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Printer className="h-3 w-3" />
                {t.openAdvancedPrint}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Print-only content - hidden on screen, shown when printing */}
      <div className="hidden print:block">
        {/* Print Card - Table Sign / Small Display Size */}
        <div className="print-card mx-auto max-w-md p-8">
          {/* Event Name */}
          <div className="mb-2 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{event.name}</h1>
          </div>

          {/* Headline */}
          <div className="mb-4 text-center">
            <p className="text-lg font-semibold text-gray-900">{headline}</p>
          </div>

          {/* QR Code */}
          <div className="mb-4 flex justify-center">
            <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
              <QRCodeSVG
                value={eventUrl}
                size={180}
                level="H"
                includeMargin={true}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
          </div>

          {/* Instructions */}
          <div className="mb-4 text-center">
            <p className="text-base font-medium text-gray-900">{instruction}</p>
            <p className="mt-1 text-sm text-gray-500">
              Or visit: {baseUrl}/event/{event.slug}
            </p>
          </div>

          {/* Event Code */}
          <div className="mb-4 text-center">
            <p className="text-xs uppercase tracking-wide text-gray-400">{t.roomCode}</p>
            <p className="text-xl font-mono font-semibold text-gray-900">{event.slug}</p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-center gap-2 border-t border-gray-200 pt-4">
            <p className="text-sm font-medium text-gray-500">{trustLine}</p>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: auto;
            margin: 10mm;
          }
          
          body * {
            visibility: hidden;
          }
          
          .print-card,
          .print-card * {
            visibility: visible;
          }
          
          .print-card {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            width: 100%;
            max-width: 400px;
          }
          
          /* Ensure clean background */
          .print-card {
            background: white;
            box-shadow: none;
          }
        }
      `}</style>

      <ToastComponent />
    </>
  )
}

export default EventQRModal
