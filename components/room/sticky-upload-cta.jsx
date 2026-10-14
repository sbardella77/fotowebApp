'use client'

import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function StickyUploadCta({ visible, t, onClick }) {
  return (
    <div className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4 transition-opacity duration-200 motion-reduce:transition-none sm:hidden ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <Button size="lg" className="h-14 w-full gap-2 rounded-xl text-base font-body font-semibold cta-primary shadow-lg" aria-label={t.addPhotos} onClick={onClick}>
        <ImagePlus className="h-5 w-5" />{t.addPhotos}
      </Button>
    </div>
  )
}
