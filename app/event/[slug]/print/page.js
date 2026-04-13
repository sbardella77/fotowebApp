'use client'

import { useEffect, useState, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Camera } from 'lucide-react'
import { useParams } from 'next/navigation'

// Print layout sizes
const SIZES = {
  a4: { name: 'A4 Poster', description: 'Perfect for entrance displays' },
  a5: { name: 'A5 Sign', description: 'Great for table centerpieces' },
  card: { name: 'Card (4×6")', description: 'Ideal for table placement' },
}

export default function PrintEventPage() {
  const params = useParams()
  const slug = params?.slug
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSize, setSelectedSize] = useState('a4')

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  
  const eventUrl = useMemo(() => {
    if (!slug) return ''
    return `${baseUrl}/event/${slug}`
  }, [slug, baseUrl])

  useEffect(() => {
    if (!slug) return

    const loadEvent = async () => {
      try {
        const response = await fetch(`/api/events/${slug}`, { cache: 'no-store' })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload.error || 'Event not found')
        }

        setEvent(payload.event)
      } catch (err) {
        setError(err.message || 'Failed to load event')
      } finally {
        setLoading(false)
      }
    }

    loadEvent()
  }, [slug])

  // Auto-print when loaded (with slight delay to ensure render)
  useEffect(() => {
    if (event && !loading) {
      const timer = setTimeout(() => {
        // Only auto-print on first load, not on size changes
        if (!window.hasAutoPrinted) {
          window.hasAutoPrinted = true
          window.print()
        }
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [event, loading])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading event...</p>
        </div>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Event not found</h1>
          <p className="text-muted-foreground mb-4">{error || 'This event does not exist or has been removed.'}</p>
          <a 
            href="/" 
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Screen controls - hidden when printing */}
      <div className="print:hidden border-b bg-white px-4 py-3">
        <div className="mx-auto max-w-4xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            <span className="font-semibold">Moment</span>
            <span className="text-muted-foreground">— Print Event QR Card</span>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Size selector */}
            <select
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            >
              {Object.entries(SIZES).map(([key, { name }]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
            
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Print
            </button>
          </div>
        </div>
        
        {/* Size description */}
        <p className="mx-auto max-w-4xl mt-2 text-xs text-muted-foreground">
          {SIZES[selectedSize].description}. Select your preferred size and click Print.
        </p>
      </div>

      {/* Print preview area */}
      <div className="p-4 sm:p-8">
        <div className={`mx-auto bg-white shadow-lg print:shadow-none ${getSizeClasses(selectedSize)}`}>
          {/* Print Card Content */}
          <PrintCardContent event={event} eventUrl={eventUrl} baseUrl={baseUrl} />
        </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: ${getPageSize(selectedSize)};
            margin: 0;
          }
          
          body {
            background: white;
          }
          
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  )
}

// Get Tailwind classes for each size
function getSizeClasses(size) {
  switch (size) {
    case 'a4':
      return 'w-[210mm] min-h-[297mm] p-[20mm]'
    case 'a5':
      return 'w-[148mm] min-h-[210mm] p-[15mm]'
    case 'card':
      return 'w-[152mm] min-h-[102mm] p-[12mm]'
    default:
      return 'w-[210mm] min-h-[297mm] p-[20mm]'
  }
}

// Get page size for @page rule
function getPageSize(size) {
  switch (size) {
    case 'a4':
      return 'A4 portrait'
    case 'a5':
      return 'A5 portrait'
    case 'card':
      return '152mm 102mm'
    default:
      return 'A4 portrait'
  }
}

// Print card content component
function PrintCardContent({ event, eventUrl, baseUrl }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60mm] text-center">
      {/* Header / Logo */}
      <div className="mb-6 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Camera className="h-5 w-5 text-primary" />
        </div>
        <span className="text-xl font-bold tracking-tight">Moment</span>
      </div>

      {/* Event Name */}
      <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">
        {event.name}
      </h1>
      
      <p className="text-base text-gray-500 mb-8">
        Scan to join the photo gallery
      </p>

      {/* QR Code - Large */}
      <div className="mb-8">
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-6">
          <QRCodeSVG
            value={eventUrl}
            size={200}
            level="M"
            includeMargin={true
            bgColor="#ffffff"
            fgColor="#000000"
          />
        </div>
      </div>

      {/* Instructions */}
      <p className="text-lg font-medium text-gray-900 mb-2">
        Scan to upload your photos
      </p>
      
      {/* URL */}
      <p className="text-sm text-gray-500 mb-6">
        {baseUrl}/event/{event.slug}
      </p>

      {/* Event Code */}
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Event Code</p>
        <p className="text-2xl font-mono font-bold text-gray-900">{event.slug}</p>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-6 border-t border-gray-200 w-full max-w-xs">
        <p className="text-xs text-gray-400">
          Share your moments • No app required
        </p>
      </div>
    </div>
  )
}
