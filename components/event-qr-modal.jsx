'use client'

import { useRef, useMemo, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { 
  X, 
  Copy, 
  Download, 
  Printer, 
  Share2, 
  Camera,
  CheckCircle2,
  Link2,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  baseUrl = typeof window !== 'undefined' ? window.location.origin : '' 
}) {
  const { showToast, ToastComponent } = useToast()
  const qrContainerRef = useRef(null)
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

  const { headline, instruction, trustLine } = getQRCopy(event?.eventType)

  // Download QR code as PNG
  const handleDownload = useCallback(async () => {
    if (!qrContainerRef.current) return
    
    try {
      const svg = qrContainerRef.current.querySelector('svg')
      if (!svg) {
        showToast('QR code not found', 'error')
        return
      }

      // Get SVG data
      const svgData = new XMLSerializer().serializeToString(svg)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)
      
      // Create image and canvas
      const img = new Image()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        showToast('Failed to create image', 'error')
        return
      }
      
      // Set canvas size (larger for better quality)
      const size = 800
      canvas.width = size
      canvas.height = size
      
      img.onload = () => {
        // Fill white background
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size, size)
        
        // Draw QR code
        ctx.drawImage(img, 0, 0, size, size)
        
        // Convert to PNG and download
        if (typeof canvas.toBlob !== 'function') {
          showToast('Download not supported on this browser', 'error')
          URL.revokeObjectURL(url)
          return
        }
        canvas.toBlob((blob) => {
          if (!blob) {
            showToast('Failed to generate image', 'error')
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
            URL.revokeObjectURL(url)
            showToast('QR code downloaded!')
          } catch (e) {
            console.warn('[qr-modal] download failed', e)
            showToast('Download failed', 'error')
          }
        }, 'image/png')
      }
      
      img.onerror = () => {
        URL.revokeObjectURL(url)
        showToast('Failed to generate image', 'error')
      }
      
      img.src = url
    } catch (error) {
      console.error('Download error:', error)
      showToast('Download failed', 'error')
    }
  }, [filename, showToast])

  // Copy event link
  const handleCopyLink = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
      showToast('Copy not supported on this device', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(eventUrl)
      setCopiedLink(true)
      showToast('Link copied!')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      showToast('Failed to copy', 'error')
    }
  }, [eventUrl, showToast])

  // Copy event code
  const handleCopyCode = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) {
      showToast('Copy not supported on this device', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(event?.slug || '')
      setCopiedCode(true)
      showToast('Code copied!')
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      showToast('Failed to copy', 'error')
    }
  }, [event?.slug, showToast])

  // Share (native or fallback)
  const handleShare = useCallback(async () => {
    const shareData = {
      title: `Join ${event?.name} on SnapRooms`,
      text: `Upload your photos to ${event?.name}! Use code: ${event?.slug}`,
      url: eventUrl,
    }
    
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData)
        showToast('Shared!')
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

  if (!isOpen || !event) return null

  return (
    <>
      {/* Main Modal Overlay */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm print:hidden"
        onClick={onClose}
      >
        <div
          className="relative my-auto w-full max-w-md overflow-hidden rounded-2xl bg-background shadow-2xl max-h-[90vh] overflow-y-auto overscroll-contain"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header with gradient */}
          <div className="relative bg-gradient-to-br from-primary/5 via-background to-background px-6 pb-4 pt-6">
            {/* Close button */}
            <button
              className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header Content */}
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Camera className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">Share this room</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Guests scan the QR code to open the room and add photos instantly.
              </p>
            </div>
          </div>

          {/* Modal Body */}
          <div className="px-6 pb-6">
            {/* Event Name Card */}
            <div className="mb-4 rounded-xl border border-border/50 bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Room</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{event.name}</p>
            </div>

            {/* Logo */}
            <img
              src="/snaprooms-logo.svg"
              alt="SnapRooms"
              className="h-10 w-10 mx-auto mb-3 rounded-md object-cover"
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
                    src="/snaprooms-logo.svg"
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
                <span className="text-muted-foreground">Code:</span>
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
                <span className="text-xs">Copy link</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                <span className="text-xs">Download QR</span>
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handlePrint}
              >
                <Printer className="h-4 w-4" />
                <span className="text-xs">Quick print</span>
              </Button>
              
              <Button
                variant="secondary"
                size="sm"
                className="flex-col gap-1 h-auto py-3"
                onClick={handleShare}
              >
                <Share2 className="h-4 w-4" />
                <span className="text-xs">Share</span>
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
                Open advanced print page
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
            <p className="text-xs uppercase tracking-wide text-gray-400">Room code</p>
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
